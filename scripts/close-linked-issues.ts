#!/usr/bin/env bun
/**
 * Closes what a merged pull request says it closes.
 *
 * GitHub closes an issue on merge only for the first reference after a closing
 * keyword. "Closes #1, #2" closes #1 and leaves #2 open. "Supersedes #3" is not
 * a keyword at all. A pull request is never closed by a reference. This script
 * reads the merged PR's description and closes the rest: issues as completed,
 * pull requests as superseded.
 *
 * The description is not searched with a regex. A reference counts only when a
 * keyword leads it, directly or through a list:
 *
 *   Fixes #1                 Closes: #2               Supersedes #3 and #4
 *   Resolves #5, #6          Replaces #7, #8, and #9  Fixes #1 & #2
 *   Closes https://github.com/oven-sh/bun/issues/10   Fixes oven-sh/bun#11
 *   Fixes [#12](https://github.com/oven-sh/bun/issues/12)
 *
 * A bare "#1", "see #1", "related to #1", "part of #1", "fix for #1" or
 * "#1's approach" is left alone. So is a keyword that is negated or hedged
 * ("does not fix #1", "partially fixes #1", "may fix #1"), or that is not a
 * verb ("the closed #1", "the rm fix #1"), or whose subject is another
 * reference ("#100 supersedes #1"). Text in code spans, fenced code blocks,
 * blockquotes, HTML comments and ~~strikethrough~~ is skipped.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY ("owner/repo"), PR_NUMBER.
 * GITHUB_API_URL overrides the API origin. DRY_RUN=1 prints the plan and
 * changes nothing.
 */

const KEYWORDS: ReadonlySet<string> = new Set([
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved",
  "supersede",
  "supersedes",
  "superseded",
  "replace",
  "replaces",
  "replaced",
]);

/**
 * A keyword led by one of these does not state that the PR closes anything:
 * a negation ("does not fix #1"), a hedge ("may fix #1", "partially fixes #1"),
 * or a determiner or preposition that makes the keyword an adjective ("the
 * closed #1", "a comment on closed #1").
 */
const DISQUALIFIERS: ReadonlySet<string> = new Set([
  "not",
  "never",
  "without",
  "cannot",
  "can't",
  "doesn't",
  "don't",
  "won't",
  "didn't",
  "isn't",
  "wasn't",
  "partially",
  "partly",
  "partial",
  "may",
  "might",
  "could",
  "would",
  "possibly",
  "probably",
  "potentially",
  "maybe",
  "hopefully",
  "likely",
  "unlikely",
  "the",
  "a",
  "an",
  "of",
  "on",
  "in",
  "by",
  "from",
  "with",
  "for",
  "than",
]);

/**
 * The base forms are nouns as often as verbs ("the rm fix #1"). They count only
 * where a noun cannot stand: at the start of a sentence or line ("Fix #1"), or
 * after one of these words ("will fix #1", "and fix #1"). "to" is not one of
 * them: an infinitive says nothing about what the PR does ("unable to fix #1",
 * "how to fix #1", "decided not to close #1").
 */
const BASE_FORMS: ReadonlySet<string> = new Set(["close", "fix", "resolve", "supersede", "replace"]);
const VERB_MARKERS: ReadonlySet<string> = new Set([
  "will",
  "shall",
  "should",
  "does",
  "do",
  "did",
  "and",
  "we",
  "they",
  "i",
]);

/** Adverbs that can sit between a disqualifier or verb marker and the keyword: "may also fix", "will fully fix". */
const ADVERBS: ReadonlySet<string> = new Set([
  "also",
  "fully",
  "completely",
  "entirely",
  "actually",
  "really",
  "yet",
  "directly",
  "properly",
]);

export interface LinkedReference {
  /** "owner/repo", lowercased. A bare "#1" takes the repository of the PR. */
  repository: string;
  number: number;
  /** The keyword that led the reference, lowercased. */
  keyword: string;
}

type Token =
  | { kind: "word"; text: string }
  | { kind: "ref"; repository: string | null; number: number; attached: boolean }
  | { kind: "punct"; text: string }
  /** One line break. A list continues past it only after a separator: "Fixes #1,\n#2". */
  | { kind: "newline" }
  /** A blank line. Nothing continues past it. */
  | { kind: "break" };

type RefToken = Extract<Token, { kind: "ref" }>;

/**
 * Finds every issue or pull request that `body` says the PR closes, in order of
 * appearance. Duplicates, the PR itself and other repositories are not
 * filtered here.
 */
export function findLinkedReferences(body: string, repository: string): LinkedReference[] {
  const self = repository.toLowerCase();
  const tokens = tokenize(stripNonProse(body));
  const found: LinkedReference[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind !== "word" || !KEYWORDS.has(token.text) || !isClosingStatement(tokens, i, token.text)) {
      i++;
      continue;
    }
    let j = i + 1;
    if (isPunct(tokens[j], ":")) j++;
    let ref = readReference(tokens, j);
    if (ref === null) {
      i++;
      continue;
    }
    for (;;) {
      found.push({ repository: ref.token.repository ?? self, number: ref.token.number, keyword: token.text });
      j = ref.end;
      // "#1, #2", "#1 and #2", "#1, and #2", "#1 & #2"
      let k = j;
      if (isPunct(tokens[k], ",")) k++;
      if (isWord(tokens[k], "and") || isPunct(tokens[k], "&")) k++;
      if (k === j) break;
      if (tokens[k]?.kind === "newline") k++;
      ref = readReference(tokens, k);
      if (ref === null) break;
    }
    i = j;
  }
  return found;
}

/** Whether the keyword at `index` states that the PR closes what follows. Decided by the word before it. */
function isClosingStatement(tokens: Token[], index: number, keyword: string): boolean {
  let k = index - 1;
  for (; k >= 0; k--) {
    const token = tokens[k];
    if (token.kind !== "word" || !ADVERBS.has(token.text)) break;
  }
  const before = tokens[k];
  // "#100 supersedes #1": another pull request is the subject. A line break
  // ends that reading: "Fixes #1\nFixes #2" is two statements.
  if (before?.kind === "ref") return false;
  if (before === undefined || before.kind !== "word") return true;
  if (DISQUALIFIERS.has(before.text)) return false;
  return !BASE_FORMS.has(keyword) || VERB_MARKERS.has(before.text);
}

function isPunct(token: Token | undefined, text: string): boolean {
  return token !== undefined && token.kind === "punct" && token.text === text;
}

function isWord(token: Token | undefined, text: string): boolean {
  return token !== undefined && token.kind === "word" && token.text === text;
}

/** A reference token, or a markdown link `[#1](url)` / `[text](issue url)`, at `index`. */
function readReference(tokens: Token[], index: number): { token: RefToken; end: number } | null {
  const token = tokens[index];
  if (token === undefined) return null;
  if (token.kind === "ref") return token.attached ? null : { token, end: index + 1 };
  if (!isPunct(token, "[")) return null;
  let close = index + 1;
  while (close < tokens.length && close < index + 10 && !isPunct(tokens[close], "]")) {
    if (tokens[close].kind === "newline" || tokens[close].kind === "break") return null;
    close++;
  }
  if (!isPunct(tokens[close], "]") || !isPunct(tokens[close + 1], "(") || !isPunct(tokens[close + 3], ")")) return null;
  const target = tokens[close + 2];
  if (target.kind === "ref" && !target.attached) return { token: target, end: close + 4 };
  const label = tokens[index + 1];
  if (close === index + 2 && label.kind === "ref" && !label.attached) return { token: label, end: close + 4 };
  return null;
}

/** Removes HTML comments, fenced code blocks, blockquotes, code spans and struck-through text. */
function stripNonProse(body: string): string {
  let text = removeHtmlComments(body.replaceAll("\r\n", "\n"));
  text = removeFencesAndQuotes(text);
  text = removeSpans(text, "`");
  text = removeSpans(text, "~", 2);
  return text;
}

function removeHtmlComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("<!--", i);
    if (start === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start) + " ";
    const end = text.indexOf("-->", start + 4);
    if (end === -1) break;
    i = end + 3;
  }
  return out;
}

function removeFencesAndQuotes(text: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (fence !== null) {
      if (trimmed.startsWith(fence) && isRunOf(trimmed.slice(fence.length), fence[0])) fence = null;
      kept.push("");
      continue;
    }
    const opening = leadingRun(trimmed, "`") || leadingRun(trimmed, "~");
    // A backtick fence's info string cannot hold a backtick: "```bun test```" is a code span.
    const isFence = opening.length >= 3 && (opening[0] === "~" || !trimmed.slice(opening.length).includes("`"));
    if (isFence) {
      fence = opening;
      kept.push("");
    } else if (trimmed.startsWith(">")) {
      kept.push("");
    } else {
      kept.push(line);
    }
  }
  return kept.join("\n");
}

function leadingRun(text: string, char: string): string {
  let n = 0;
  while (text[n] === char) n++;
  return text.slice(0, n);
}

function isRunOf(text: string, char: string): boolean {
  return leadingRun(text, char).length === text.length;
}

/**
 * Removes the text between a run of `marker` and the next run of the same
 * length: `code spans` for "`", ~~struck-through text~~ for "~" with `runLength` 2.
 * A run with no closing run stays as it is.
 */
function removeSpans(text: string, marker: string, runLength?: number): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== marker) {
      out += text[i];
      i++;
      continue;
    }
    const opening = leadingRun(text.slice(i), marker);
    let close = -1;
    let from = runLength === undefined || opening.length === runLength ? i + opening.length : text.length;
    while (from < text.length) {
      const at = text.indexOf(opening, from);
      if (at === -1) break;
      const run = leadingRun(text.slice(at), marker);
      if (run.length === opening.length) {
        close = at;
        break;
      }
      from = at + run.length;
    }
    if (close === -1) {
      out += opening;
      i += opening.length;
      continue;
    }
    out += " ";
    i = close + opening.length;
  }
  return out;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (isSpace(text[i])) {
      let newlines = 0;
      while (i < text.length && isSpace(text[i])) {
        if (text[i] === "\n") newlines++;
        i++;
      }
      if (newlines >= 2) tokens.push({ kind: "break" });
      else if (newlines === 1) tokens.push({ kind: "newline" });
      continue;
    }
    let end = i + 1;
    while (end < text.length && !isSpace(text[end])) end++;
    tokenizeChunk(text.slice(i, end), tokens);
    i = end;
  }
  return tokens;
}

/** Splits one whitespace-free chunk into words, references and punctuation. */
function tokenizeChunk(chunk: string, tokens: Token[]): void {
  let i = 0;
  let afterWord = false;
  while (i < chunk.length) {
    const c = chunk[i];
    if (isLetter(c) || isDigit(c)) {
      const url = readUrl(chunk, i);
      if (url !== null) {
        tokens.push(url.token);
        i = url.end;
        afterWord = true;
        continue;
      }
      let end = i + 1;
      while (end < chunk.length && isWordChar(chunk[end])) end++;
      while (end > i + 1 && isTrailingPunct(chunk[end - 1])) end--;
      const word = chunk.slice(i, end);
      if (chunk[end] === "#" && isOwnerRepo(word)) {
        const number = readNumber(chunk, end + 1);
        if (number !== null) {
          tokens.push({
            kind: "ref",
            repository: word.toLowerCase(),
            number: number.value,
            attached: isAttached(chunk, number.end),
          });
          i = number.end;
          afterWord = true;
          continue;
        }
      }
      tokens.push({ kind: "word", text: word.toLowerCase().replaceAll("\u2019", "'") });
      i = end;
      afterWord = true;
      continue;
    }
    if (c === "#" && !afterWord) {
      const number = readNumber(chunk, i + 1);
      if (number !== null) {
        tokens.push({ kind: "ref", repository: null, number: number.value, attached: isAttached(chunk, number.end) });
        i = number.end;
        afterWord = true;
        continue;
      }
    }
    tokens.push({ kind: "punct", text: c });
    i++;
    afterWord = false;
  }
}

/**
 * An http(s) URL at `start` runs to the end of the chunk, minus trailing
 * punctuation. A GitHub issue or pull request URL is a reference. Any other URL
 * is one opaque word.
 */
function readUrl(chunk: string, start: number): { token: Token; end: number } | null {
  const lower = chunk.slice(start).toLowerCase();
  let p: number;
  if (lower.startsWith("https://")) p = "https://".length;
  else if (lower.startsWith("http://")) p = "http://".length;
  else return null;
  let end = chunk.length;
  while (end > start + p && isTrailingPunct(chunk[end - 1])) end--;
  const url = chunk.slice(start, end);
  const ref = parseGitHubUrl(url.slice(p));
  return { token: ref ?? { kind: "word", text: url }, end };
}

/** `[www.]github.com/owner/repo/(issues|pull)/N[#fragment|?query|/more]` */
function parseGitHubUrl(afterScheme: string): RefToken | null {
  let path = afterScheme;
  if (path.toLowerCase().startsWith("www.")) path = path.slice("www.".length);
  if (!path.toLowerCase().startsWith("github.com/")) return null;
  const segments = path.slice("github.com/".length).split("/");
  if (segments.length < 4) return null;
  const [owner, repo, kind, last] = segments;
  if (!isOwnerRepo(`${owner}/${repo}`)) return null;
  if (kind !== "issues" && kind !== "pull") return null;
  const number = readNumber(last, 0);
  if (number === null) return null;
  const after = last[number.end];
  if (after !== undefined && after !== "#" && after !== "?") return null;
  return { kind: "ref", repository: `${owner}/${repo}`.toLowerCase(), number: number.value, attached: false };
}

function readNumber(text: string, start: number): { value: number; end: number } | null {
  let end = start;
  while (end < text.length && isDigit(text[end])) end++;
  if (end === start || end - start > 9) return null;
  const value = Number(text.slice(start, end));
  return value > 0 ? { value, end } : null;
}

/** "#1's", "#1abc": the number is part of a longer word, not a reference. */
function isAttached(chunk: string, index: number): boolean {
  const c = chunk[index];
  return c !== undefined && (isLetter(c) || isDigit(c) || c === "'" || c === "\u2019" || c === "_");
}

function isOwnerRepo(text: string): boolean {
  const parts = text.split("/");
  return parts.length === 2 && parts.every(part => part.length > 0 && [...part].every(isNameChar));
}

function isLetter(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isNameChar(c: string): boolean {
  return isLetter(c) || isDigit(c) || c === "-" || c === "_" || c === ".";
}

function isWordChar(c: string): boolean {
  return isNameChar(c) || c === "/" || c === "'" || c === "\u2019";
}

function isTrailingPunct(c: string): boolean {
  return ".,;:!?)]'\"*>-/\u2019".includes(c);
}

function isSpace(c: string): boolean {
  return c.trim() === "";
}

interface PullRequest {
  number: number;
  body: string | null;
  merged: boolean;
  base: { ref: string; repo: { default_branch: string } };
}

interface Issue {
  number: number;
  state: "open" | "closed";
  pull_request?: object;
}

class GitHub {
  readonly origin = process.env.GITHUB_API_URL || "https://api.github.com";

  constructor(
    private readonly token: string,
    readonly repository: string,
  ) {}

  /** GET; `null` on 404. */
  async get<T>(path: string): Promise<T | null> {
    const response = await this.request("GET", path);
    if (response.status === 404) return null;
    return response.json() as Promise<T>;
  }

  async patch(path: string, body: unknown): Promise<void> {
    await this.request("PATCH", path, body);
  }

  async post(path: string, body: unknown): Promise<void> {
    await this.request("POST", path, body);
  }

  private async request(method: string, path: string, body?: unknown, attempt = 0): Promise<Response> {
    const response = await fetch(`${this.origin}/repos/${this.repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "close-linked-issues-script",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if ((response.status === 403 || response.status === 429) && response.headers.has("retry-after") && attempt < 3) {
      const seconds = Number(response.headers.get("retry-after")) || 2 ** attempt;
      console.warn(`rate limited on ${method} ${path}, retrying in ${seconds}s`);
      await Bun.sleep(seconds * 1000);
      return this.request(method, path, body, attempt + 1);
    }
    if (!response.ok && response.status !== 404) {
      throw new Error(`${method} ${path} failed: ${response.status} ${response.statusText} ${await response.text()}`);
    }
    return response;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

async function closeReference(api: GitHub, pr: PullRequest, ref: LinkedReference, dryRun: boolean): Promise<void> {
  const issue = await api.get<Issue>(`/issues/${ref.number}`);
  if (issue === null) {
    console.log(`#${ref.number}: does not exist, skipping`);
    return;
  }
  if (issue.state !== "open") {
    console.log(`#${ref.number}: already closed, skipping`);
    return;
  }
  const isPull = issue.pull_request !== undefined;
  const what = isPull ? "pull request" : "issue";
  if (dryRun) {
    console.log(`#${ref.number}: would close ${what} (${ref.keyword} in #${pr.number})`);
    return;
  }
  if (isPull) {
    await api.patch(`/pulls/${ref.number}`, { state: "closed" });
  } else {
    await api.patch(`/issues/${ref.number}`, { state: "closed", state_reason: "completed" });
  }
  console.log(`#${ref.number}: closed ${what} (${ref.keyword} in #${pr.number})`);
  const comment = isPull ? `Superseded by #${pr.number}.` : `Closed as completed by #${pr.number}.`;
  try {
    await api.post(`/issues/${ref.number}/comments`, { body: comment });
  } catch (error) {
    console.warn(`#${ref.number}: closed, but the comment failed: ${error}`);
  }
}

async function main(): Promise<void> {
  const token = requireEnv("GITHUB_TOKEN");
  const repository = requireEnv("GITHUB_REPOSITORY");
  const prNumber = Number(requireEnv("PR_NUMBER"));
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`PR_NUMBER is not a pull request number: ${process.env.PR_NUMBER}`);
  }
  const dryRun = !["", "0", "false"].includes(process.env.DRY_RUN ?? "");
  const api = new GitHub(token, repository);

  const pr = await api.get<PullRequest>(`/pulls/${prNumber}`);
  if (pr === null) throw new Error(`${repository}#${prNumber} is not a pull request`);
  if (!pr.merged) {
    console.log(`#${prNumber}: not merged, nothing to do`);
    return;
  }
  const defaultBranch = pr.base.repo.default_branch;
  if (pr.base.ref !== defaultBranch) {
    console.log(`#${prNumber}: merged into ${pr.base.ref}, not ${defaultBranch}, nothing to do`);
    return;
  }

  const seen = new Set<number>();
  const targets: LinkedReference[] = [];
  for (const ref of findLinkedReferences(pr.body ?? "", repository)) {
    if (ref.repository !== repository.toLowerCase()) {
      console.log(`${ref.repository}#${ref.number}: another repository, skipping`);
      continue;
    }
    if (ref.number === prNumber || seen.has(ref.number)) continue;
    seen.add(ref.number);
    targets.push(ref);
  }
  if (targets.length === 0) {
    console.log(`#${prNumber}: no references to close`);
    return;
  }
  console.log(`#${prNumber}: ${targets.map(ref => `#${ref.number}`).join(", ")}${dryRun ? " (dry run)" : ""}`);

  let failed = 0;
  for (const ref of targets) {
    try {
      await closeReference(api, pr, ref, dryRun);
    } catch (error) {
      failed++;
      console.error(`#${ref.number}: ${error}`);
    }
  }
  if (failed > 0) process.exit(1);
}

if (import.meta.main) {
  await main();
}
