import { useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://applyasap-api.thebatman3934.workers.dev/";
const IPIFY_URL =
  import.meta.env.VITE_IPIFY_URL || "https://api.ipify.org?format=json";
const COOKIE_KEY = import.meta.env.VITE_COOKIE_KEY || "applyasap_uses";

const LIMIT = 10;

GlobalWorkerOptions.workerSrc = pdfWorker;

const defaultForm = {
  companyName: "",
  position: "",
  jobDescription: "",
  question: "",
};

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = getDocument({ data: arrayBuffer });
  const pdf = await withTimeout(
    loadingTask.promise,
    15000,
    "PDF loading timed out. Please try a smaller or text-based PDF.",
  );
  const pageTexts = [];

  try {
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await withTimeout(
        pdf.getPage(pageIndex),
        10000,
        `Reading page ${pageIndex} timed out.`,
      );
      const textContent = await withTimeout(
        page.getTextContent(),
        10000,
        `Extracting text from page ${pageIndex} timed out.`,
      );
      const pageText = textContent.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pageTexts.push(pageText);
    }
  } finally {
    await loadingTask.destroy();
  }

  return pageTexts.join("\n").trim();
}

function getCookieValue(name) {
  const prefix = `${name}=`;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  const item = cookies.find((entry) => entry.startsWith(prefix));
  if (!item) {
    return 0;
  }

  const parsed = Number.parseInt(item.slice(prefix.length), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function setCookieValue(name, value, days = 30) {
  const expires = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  ).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

function getLocalCount(key) {
  const value = Number.parseInt(window.localStorage.getItem(key) ?? "0", 10);
  return Number.isNaN(value) ? 0 : value;
}

function setLocalCount(key, value) {
  window.localStorage.setItem(key, String(value));
}

function getFingerprintHash(rawFingerprint) {
  if (typeof rawFingerprint === "string" && rawFingerprint.length > 0) {
    return rawFingerprint;
  }

  if (rawFingerprint && typeof rawFingerprint === "object") {
    const candidate =
      rawFingerprint.hash ||
      rawFingerprint.visitorId ||
      rawFingerprint.id ||
      rawFingerprint.fingerprint;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }

    return btoa(
      unescape(encodeURIComponent(JSON.stringify(rawFingerprint))),
    ).slice(0, 48);
  }

  return "unknown_fingerprint";
}

function getCounterTone(remaining) {
  if (remaining <= 0) {
    return "text-zinc-100 bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100";
  }

  if (remaining <= 3) {
    return "text-zinc-900 bg-amber-300 border-amber-500";
  }

  return "text-zinc-700 dark:text-zinc-300 bg-transparent border-zinc-300 dark:border-zinc-700";
}

function App() {
  const [theme, setTheme] = useState("dark");
  const [formData, setFormData] = useState(defaultForm);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isExtractingResume, setIsExtractingResume] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resumeFileName, setResumeFileName] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [fingerprintId, setFingerprintId] = useState("unknown_fingerprint");
  const [fpKey, setFpKey] = useState("applyasap_fp_unknown_fingerprint");
  const [ipKey, setIpKey] = useState("applyasap_ip_unknown_ip");
  const [fpUses, setFpUses] = useState(0);
  const [cookieUses, setCookieUses] = useState(0);
  const [ipUses, setIpUses] = useState(0);
  const resultRef = useRef(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("applyasap_theme");
    const initialTheme =
      savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
  }, []);

  useEffect(() => {
    const initIdentity = async () => {
      try {
        const thumbmarkSource = window.ThumbmarkJS || window.thumbmark;
        const fingerprintRaw = thumbmarkSource?.getFingerprint
          ? await thumbmarkSource.getFingerprint()
          : "thumbmark_unavailable";
        const hash = getFingerprintHash(fingerprintRaw);
        const storageKey = `applyasap_fp_${hash}`;
        setFingerprintId(hash);
        setFpKey(storageKey);
        setFpUses(getLocalCount(storageKey));
      } catch {
        const fallbackKey = "applyasap_fp_fallback";
        setFingerprintId("fallback");
        setFpKey(fallbackKey);
        setFpUses(getLocalCount(fallbackKey));
      }

      setCookieUses(getCookieValue(COOKIE_KEY));

      try {
        const response = await fetch(IPIFY_URL);
        const data = await response.json();
        const key = `applyasap_ip_${data?.ip || "unknown_ip"}`;
        setIpKey(key);
        setIpUses(getLocalCount(key));
      } catch {
        const fallbackKey = "applyasap_ip_fallback";
        setIpKey(fallbackKey);
        setIpUses(getLocalCount(fallbackKey));
      }
    };

    initIdentity();
  }, []);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }

    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    if (!result) {
      return;
    }

    requestAnimationFrame(() => {
      resultRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [result]);

  const highestUsage = useMemo(
    () => Math.max(fpUses, cookieUses, ipUses),
    [fpUses, cookieUses, ipUses],
  );
  const remaining = Math.max(0, LIMIT - highestUsage);
  const isBlocked = highestUsage >= LIMIT;

  const wordCount = useMemo(() => {
    if (!result.trim()) {
      return 0;
    }
    return result.trim().split(/\s+/).length;
  }, [result]);

  const handleThemeToggle = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    window.localStorage.setItem("applyasap_theme", nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleResumeFileChange = async (event) => {
    const file = event.target.files?.[0];
    setError("");

    if (!file) {
      setResumeFileName("");
      setResumeText("");
      return;
    }

    if (file.type !== "application/pdf") {
      setResumeFileName(file.name);
      setResumeText("");
      setError("Please upload a PDF resume file.");
      return;
    }

    setResumeFileName(file.name);
    setIsExtractingResume(true);

    try {
      const extracted = await extractTextFromPdf(file);
      if (!extracted || extracted.length < 50) {
        setResumeText("");
        setError(
          "Could not extract enough text from this PDF. Please upload a clearer resume.",
        );
        return;
      }
      setResumeText(extracted);
    } catch {
      setResumeText("");
      setError("Failed to read your PDF resume. Please try another file.");
    } finally {
      setIsExtractingResume(false);
    }
  };

  const validate = () => {
    if (!formData.companyName.trim()) {
      return "Company Name is required.";
    }
    if (!formData.position.trim()) {
      return "Position / Role is required.";
    }
    if (formData.jobDescription.trim().length < 50) {
      return "Job Description must be at least 50 characters.";
    }
    if (!resumeText || resumeText.trim().length < 50) {
      return "Resume PDF text extraction must contain at least 50 characters.";
    }
    if (!formData.question.trim()) {
      return "Question is required.";
    }
    return "";
  };

  const incrementCounters = () => {
    const nextFp = fpUses + 1;
    const nextCookie = cookieUses + 1;
    const nextIp = ipUses + 1;

    setLocalCount(fpKey, nextFp);
    setLocalCount(ipKey, nextIp);
    setCookieValue(COOKIE_KEY, nextCookie, 30);

    setFpUses(nextFp);
    setCookieUses(nextCookie);
    setIpUses(nextIp);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (isBlocked) {
      setError("Usage limit reached. You have used all 10 generations.");
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    const prompt = `Company: ${formData.companyName}
                    Role: ${formData.position}

                    ${formData.jobDescription}
                    Job Description:

                    ${resumeText}
                    My Resume:

                    ${formData.question}
                    Question:

                    
                    Write a tailored, humanized answer.
                    - First, identify the key skills, tools, and responsibilities from the job description
                    STRICT INSTRUCTIONS:
                    - Then scan my resume and find the MOST RELEVANT PROJECT that matches those requirements
                    - If a matching project exists:
                    - Mention technologies used
                    - Clearly describe what I built
                    - If no strong project match exists, then use a relevant experience or achievement instead
                    - Mention measurable impact or outcome
                    - Always prioritize PROJECTS over general experience when relevant
                    - Reference at least one specific detail about ${formData.companyName} or the role
                    - Avoid generic statements and buzzwords
                    - Do NOT use bullet points, write in natural flowing paragraphs`;

    const payload = {
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert career coach writing job application answers.

CRITICAL RULES:
- You MUST prioritize relevant PROJECTS from the resume when they match the job description
- Do NOT give generic answers
- Do NOT invent projects or experiences
- Only use information explicitly present in the resume
- Always align project details with job requirements

HUMANIZATION RULES:
- Write like a real person, not an AI
- Use natural, slightly varied sentence lengths
- Avoid overly perfect or robotic phrasing
- It’s okay to sound conversational but still professional
- Include small, natural transitions (e.g., "One project that stands out is...", "What makes this especially relevant is...")
- Do NOT use buzzwords or cliché phrases

STYLE:
- Never use phrases like 'I am passionate about', 'I am excited to', 'unique opportunity', 'fast-paced environment', or 'I am a team player'
- Write in first person
- Professional but human tone
- Target 120–150 words`
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 600,
      temperature: 0.85,
    };

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-fingerprint-id": fingerprintId,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            "Rate limit reached on the API. Please wait and try again.",
          );
        }
        throw new Error(
          data?.error?.message ||
            data?.error ||
            "Request failed. Please try again.",
        );
      }

      const generated = data?.choices?.[0]?.message?.content?.trim();
      if (!generated) {
        throw new Error("No generated answer was returned by the API.");
      }

      setResult(generated);
      incrementCounters();
    } catch (requestError) {
      setError(
        requestError?.message ||
          "Something went wrong while generating your answer.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
    } catch {
      setError("Could not copy text. Please copy manually.");
    }
  };

  const generateAnother = () => {
    setResult("");
    setError("");
  };

  return (
    <div
      id="top"
      className="relative min-h-screen overflow-hidden bg-zinc-300 text-zinc-900 transition-colors duration-300 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute -left-28 top-[-120px] h-72 w-72 rounded-full bg-zinc-700/25 blur-[120px]" />
        <div className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-zinc-500/15 blur-[130px]" />
      </div>

      <main className="relative mx-auto max-w-[680px] px-4 py-6 sm:px-5 sm:py-10">
        <header className="mb-8 animate-fadeInUp border-b border-zinc-300/80 pb-6 dark:border-zinc-700/70">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h1 className="font-['Space_Grotesk',_ui-sans-serif] text-3xl font-semibold tracking-tight sm:text-4xl">
              <a
                href="/"
                aria-label="Go to ApplyASAP home"
                className="transition hover:opacity-80"
              >
                ApplyASAP
              </a>
            </h1>
            <button
              type="button"
              onClick={handleThemeToggle}
              className="w-fit self-start rounded-none border border-zinc-500 bg-transparent px-3 py-2 text-xs uppercase tracking-[0.22em] text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900 sm:self-auto dark:border-zinc-300 dark:text-zinc-200 dark:hover:border-zinc-100 dark:hover:text-zinc-100"
            >
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>

          <div className="flex items-center justify-start sm:justify-end">
            <span
              className={`rounded-none border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition ${getCounterTone(
                remaining,
              )}`}
            >
              {remaining} / 10 credits
            </span>
          </div>
        </header>

        {result ? (
          <section
            id="result"
            ref={resultRef}
            className="mb-7 animate-fadeInUp border border-zinc-500/70 bg-zinc-200 p-4 shadow-panel backdrop-blur-sm sm:p-5 dark:border-zinc-700/70 dark:bg-zinc-900/80 dark:text-zinc-100"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-['Space_Grotesk',_ui-sans-serif] text-lg font-medium tracking-tight">
                Your Generated Answer
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                  {wordCount} words
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-none border border-zinc-500 px-3 py-1.5 text-xs uppercase tracking-[0.18em] transition hover:border-zinc-900 hover:bg-zinc-900 hover:text-zinc-100 dark:border-zinc-700 dark:hover:border-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
                >
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>

            <p className="whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-200">
              {result}
            </p>

            <button
              type="button"
              onClick={generateAnother}
              className="mt-5 rounded-none border border-zinc-500 px-4 py-2 text-xs uppercase tracking-[0.2em] transition hover:border-zinc-900 hover:bg-zinc-900 hover:text-zinc-100 dark:border-zinc-700 dark:hover:border-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
            >
              Generate Another
            </button>

          </section>
        ) : null}

        
            <div className="mt-4 mb-4 flex justify-center md:hidden">
              <a
                href="https://buymeachai.ezee.li/rajank18"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Buy Me A Chai"
                className="inline-flex items-center gap-2 rounded-full border border-zinc-300/80 bg-zinc-100/90 px-4 py-2 text-zinc-900 shadow-lg shadow-black/10 backdrop-blur-md transition hover:scale-[1.03] hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/30 dark:hover:border-zinc-500"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-4 w-4 text-amber-500 dark:text-amber-300"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 8h11v4a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5V8Z" />
                  <path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17" />
                  <path d="M8 4c0 1 .5 1.5.5 2.5S8 8 8 8" />
                  <path d="M12 4c0 1 .5 1.5.5 2.5S12 8 12 8" />
                  <path d="M15 4c0 1 .5 1.5.5 2.5S15 8 15 8" />
                </svg>
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                  Buy Me A Chai
                </span>
              </a>
            </div>

        <section id="generator" className="animate-fadeInUp [animation-delay:100ms] [animation-fill-mode:both]">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="companyName"
                className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400"
              >
                Company Name
              </label>
              <input
                id="companyName"
                name="companyName"
                type="text"
                required
                value={formData.companyName}
                onChange={handleChange}
                className="w-full rounded-none border border-zinc-500/70 bg-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-600 focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-100"
                placeholder="e.g., Stripe"
              />
            </div>

            <div>
              <label
                htmlFor="position"
                className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400"
              >
                Position / Role
              </label>
              <input
                id="position"
                name="position"
                type="text"
                required
                value={formData.position}
                onChange={handleChange}
                className="w-full rounded-none border border-zinc-500/70 bg-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-600 focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-100"
                placeholder="e.g., Product Designer"
              />
            </div>

            <div>
              <label
                htmlFor="jobDescription"
                className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400"
              >
                Job Description
              </label>
              <textarea
                id="jobDescription"
                name="jobDescription"
                minLength={50}
                required
                value={formData.jobDescription}
                onChange={handleChange}
                rows={6}
                className="w-full rounded-none border border-zinc-500/70 bg-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-600 focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-100"
                placeholder="Paste the full job description here..."
              />
            </div>

            <div>
              <label
                htmlFor="resumeFile"
                className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400"
              >
                Resume (PDF)
              </label>
              <input
                id="resumeFile"
                name="resumeFile"
                type="file"
                accept="application/pdf"
                required
                onChange={handleResumeFileChange}
                className="w-full rounded-none border border-zinc-500/70 bg-zinc-200 px-4 py-3 text-sm text-zinc-900 file:mr-4 file:rounded-none file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:uppercase file:tracking-[0.18em] file:text-zinc-100 outline-none transition focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:focus:border-zinc-100"
              />
              {resumeFileName ? (
                <p className="mt-2 text-xs uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  {isExtractingResume
                    ? `Extracting text from ${resumeFileName}...`
                    : `Loaded: ${resumeFileName}`}
                </p>
              ) : null}
              {resumeText ? (
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  Resume text ready ({resumeText.trim().split(/\s+/).length}{" "}
                  words extracted)
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor="question"
                className="mb-1 block text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400"
              >
                Question
              </label>
              <input
                id="question"
                name="question"
                type="text"
                required
                value={formData.question}
                onChange={handleChange}
                className="w-full rounded-none border border-zinc-500/70 bg-zinc-200 px-4 py-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-600 focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-100"
                placeholder="e.g., Why do you want to work at our company?"
              />
            </div>

            {error ? (
              <p className="border border-zinc-500/70 bg-zinc-200 px-4 py-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading || isBlocked || isExtractingResume}
              className="group relative flex w-full items-center justify-center rounded-none border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium uppercase tracking-[0.2em] text-zinc-100 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-300 disabled:text-zinc-500 dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 dark:disabled:border-zinc-700 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-900" />
                  Generating...
                </span>
              ) : isExtractingResume ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-zinc-900" />
                  Reading Resume...
                </span>
              ) : isBlocked ? (
                "Limit Reached"
              ) : (
                "Generate Answer"
              )}
            </button>

            {!result ? (
              <div className="mt-4 flex justify-center md:hidden">
                <a
                  href="https://buymeachai.ezee.li/rajank18"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Buy Me A Chai"
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-300/80 bg-zinc-100/90 px-4 py-2 text-zinc-900 shadow-lg shadow-black/10 backdrop-blur-md transition hover:scale-[1.03] hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/30 dark:hover:border-zinc-500"
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="h-4 w-4 text-amber-500 dark:text-amber-300"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 8h11v4a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5V8Z" />
                    <path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17" />
                    <path d="M8 4c0 1 .5 1.5.5 2.5S8 8 8 8" />
                    <path d="M12 4c0 1 .5 1.5.5 2.5S12 8 12 8" />
                    <path d="M15 4c0 1 .5 1.5.5 2.5S15 8 15 8" />
                  </svg>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                    Buy Me A Chai
                  </span>
                </a>
              </div>
            ) : null}
          </form>
        </section>


        <footer
          id="footer"
          className="mt-10 border-t border-zinc-500/70 py-6 text-center text-xs uppercase tracking-[0.18em] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
        >
          Made by{" "}
          <a
            href="https://github.com/rajank18"
            target="_blank"
            rel="noreferrer"
            className="text-inherit text-white"
          >
            Rajan
          </a>
        </footer>
      </main>

      <a
        href="https://buymeachai.ezee.li/rajank18"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed right-2 top-1/2 z-50 hidden -translate-y-1/2 rounded-full border border-zinc-300/80 bg-zinc-100/90 px-3 py-2 text-zinc-900 shadow-lg shadow-black/10 backdrop-blur-md transition hover:scale-[1.03] hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/30 dark:hover:border-zinc-500 md:inline-flex sm:right-4"
        aria-label="Buy Me A Chai"
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] sm:text-xs">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-4 w-4 text-amber-500 dark:text-amber-300"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 8h11v4a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5V8Z" />
            <path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17" />
            <path d="M8 4c0 1 .5 1.5.5 2.5S8 8 8 8" />
            <path d="M12 4c0 1 .5 1.5.5 2.5S12 8 12 8" />
            <path d="M15 4c0 1 .5 1.5.5 2.5S15 8 15 8" />
          </svg>
          <span>Buy Me A Chai</span>
        </span>
      </a>
    </div>
  );
}

export default App;
