#!/usr/bin/env bun
/**
 * Lint test files for known flake anti-patterns.
 *
 * Scans every `test/**\/*.test.*` and flags patterns that have repeatedly
 * caused flakes in CI. All findings are reported; with `--changed <base>`
 * only findings on lines *added* relative to `<base>` are treated as errors
 * (exit 1), the rest stay warnings. That way existing violations don't block
 * a PR that happens to touch the same file, and day-one adoption needs no
 * sweeping cleanup.
 *
 * Suppress a single finding with a `// lint-tests-allow: <reason>` comment on
 * the same line or the line above.
 *
 *   bun scripts/lint-tests.ts                  # warnings only, exit 0
 *   bun scripts/lint-tests.ts --changed main   # error on lines added vs main
 *   bun scripts/lint-tests.ts --all-errors     # every finding is an error
 *   bun scripts/lint-tests.ts --json           # machine-readable
 *   bun scripts/lint-tests.ts path/to/a.test.ts ...   # only these files
 *
 * Runs under the system bun, no build needed.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ALLOW_COMMENT = /\/\/\s*lint-tests-allow\b/;
// Cheap pre-filter: skip rule matching on lines that can't possibly hit any rule.
const TRIGGER = /port:|sleep|setTimeout|setDefaultTimeout|fetch\(|fetch \(|tmpdirSync/;
const isGithubActions = !!process.env.GITHUB_ACTIONS;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const allErrors = args.includes("--all-errors");
const quiet = args.includes("--quiet"); // errors only, hide warnings
const changedIdx = args.indexOf("--changed");
const changedBase = changedIdx >= 0 ? args[changedIdx + 1] || "origin/main" : undefined;
const explicitFiles = args.filter((a, i) => !a.startsWith("--") && !(changedIdx >= 0 && i === changedIdx + 1));

// ── lexical classification ──────────────────────────────────────────────────
// Regex on source text hits noise inside strings and comments. Rather than a
// full parse, track just enough state per line to know which byte ranges are
// "code" vs string/comment. This is not a tokenizer; it's the minimum to stop
// multiline template literals and /* */ blocks from triggering every rule.

interface LineState {
  inTemplate: boolean;
  inBlockComment: boolean;
}

const CODE = 0,
  TMPL = 1,
  BLOCK = 2,
  SQ = 3,
  DQ = 4;
let maskBuf = new Uint8Array(1024);

/** Byte-mask over `line`: 1 where the char is live code (not string/comment). */
function classify(line: string, state: LineState): Uint8Array {
  const n = line.length;
  if (maskBuf.length < n) maskBuf = new Uint8Array(n * 2);
  const code = maskBuf;
  let i = 0;
  let mode = state.inTemplate ? TMPL : state.inBlockComment ? BLOCK : CODE;
  while (i < n) {
    const c = line.charCodeAt(i);
    if (mode === CODE) {
      if (c === 47 /* / */) {
        const next = line.charCodeAt(i + 1);
        if (next === 47 /* / */) {
          while (i < n) code[i++] = 0;
          break;
        }
        if (next === 42 /* * */) {
          mode = BLOCK;
          code[i] = 0;
          code[i + 1] = 0;
          i += 2;
          continue;
        }
      }
      if (c === 34 /* " */) {
        mode = DQ;
        code[i++] = 1;
        continue;
      }
      if (c === 39 /* ' */) {
        mode = SQ;
        code[i++] = 1;
        continue;
      }
      if (c === 96 /* ` */) {
        mode = TMPL;
        code[i++] = 1;
        continue;
      }
      code[i++] = 1;
      continue;
    }
    if (mode === BLOCK) {
      if (c === 42 /* * */ && line.charCodeAt(i + 1) === 47 /* / */) {
        mode = CODE;
        code[i] = 0;
        code[i + 1] = 0;
        i += 2;
        continue;
      }
      code[i++] = 0;
      continue;
    }
    if (mode === DQ || mode === SQ) {
      if (c === 92 /* \\ */) {
        code[i] = 0;
        code[i + 1] = 0;
        i += 2;
        continue;
      }
      if ((mode === DQ && c === 34) || (mode === SQ && c === 39)) {
        mode = CODE;
        code[i++] = 1;
        continue;
      }
      code[i++] = 0;
      continue;
    }
    // TMPL. Interpolation bodies stay "in template"; good enough for FP suppression.
    if (c === 92 /* \\ */) {
      code[i] = 0;
      code[i + 1] = 0;
      i += 2;
      continue;
    }
    if (c === 96 /* ` */) {
      mode = CODE;
      code[i++] = 1;
      continue;
    }
    code[i++] = 0;
  }
  state.inTemplate = mode === TMPL;
  state.inBlockComment = mode === BLOCK;
  return code;
}

// ── rules ───────────────────────────────────────────────────────────────────

interface Rule {
  name: string;
  why: string;
  // Return the 0-based column of the finding, or -1 for none.
  // `code[i]` is 1 iff byte i of `line` is live code.
  match: (line: string, code: Uint8Array) => number;
}

function firstCodeMatch(line: string, code: Uint8Array, re: RegExp): RegExpExecArray | null {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (code[m.index]) return m;
    if (!re.global) break;
  }
  return null;
}

const rules: Rule[] = [
  {
    name: "hardcoded-port",
    why: "use `port: 0` and read back the bound port; hardcoded ports race in parallel CI",
    match(line, code) {
      // port: <1024-65535> as a literal. More digits would be >65535 and already invalid.
      const m = firstCodeMatch(line, code, /\bport:\s*([1-9]\d{3,4})(?![\d_])/g);
      if (!m) return -1;
      // Skip obvious assertion/data-table lines; they don't bind a socket.
      if (/\b(?:expect|assert|toEqual|toBe|toMatchObject|deepStrictEqual)\b/.test(line)) return -1;
      return m.index;
    },
  },
  {
    name: "long-sleep",
    why: "sleep >=1s is almost always 'wait and hope'; await the condition instead",
    match(line, code) {
      const m = firstCodeMatch(
        line,
        code,
        /\b(?:Bun\.sleep(?:Sync)?|await\s+sleep)\s*\(\s*[1-9][\d_]{3,}\b|\bsetTimeout\s*\(\s*resolve\s*,\s*[1-9][\d_]{3,}\b/g,
      );
      if (!m) return -1;
      // `Promise.race([x, Bun.sleep(N)])` is a timeout guard, not wait-and-hope.
      if (/\bPromise\.race\b/.test(line)) return -1;
      return m.index;
    },
  },
  {
    name: "long-default-timeout",
    why: "a 2min+ default timeout multiplies into hours across retries when a test hangs",
    match(line, code) {
      const m = firstCodeMatch(line, code, /\bsetDefaultTimeout\s*\(\s*([^)]+)\)/g);
      if (!m) return -1;
      const expr = m[1].replace(/_/g, "");
      if (!/^[\d\s*+]+$/.test(expr)) return -1; // non-literal (e.g. a variable), skip
      let ms: number;
      try {
        ms = Function(`"use strict"; return (${expr})`)();
      } catch {
        return -1;
      }
      return ms >= 120_000 ? m.index : -1;
    },
  },
  {
    name: "external-fetch",
    why: "live-internet fetch flakes; use a local server, unix socket, or proxy to localhost",
    match(line, code) {
      const re = /\bfetch\s*\(\s*["'`]https?:\/\/([A-Za-z0-9][^/"'`\s:?#]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        if (!code[m.index]) continue;
        const host = m[1].toLowerCase();
        if (host === "localhost" || host === "0.0.0.0" || host.startsWith("127.")) continue;
        if (host.includes("${")) continue;
        return m.index;
      }
      return -1;
    },
  },
  {
    name: "tmpdirSync",
    why: "use `tempDir` from 'harness' (auto-cleanup via `using`); tmpdirSync leaks directories",
    match(line, code) {
      const m = firstCodeMatch(line, code, /\btmpdirSync\s*\(/g);
      return m ? m.index : -1;
    },
  },
];

// ── collect test files ──────────────────────────────────────────────────────

function listTestFiles(): string[] {
  if (explicitFiles.length) {
    return explicitFiles.map(f => relative(ROOT, resolve(f)).replaceAll("\\", "/"));
  }
  const glob = new Bun.Glob("test/**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}");
  const out: string[] = [];
  for (let f of glob.scanSync({ cwd: ROOT })) {
    f = f.replaceAll("\\", "/");
    if (
      f.includes("/node_modules/") ||
      f.includes("/fixtures/") ||
      f.includes("/fixture/") ||
      f.includes("/snapshots/") ||
      f.includes("/__snapshots__/") ||
      // Vendored/adapted upstream test suites; not held to our authored-test conventions.
      f.startsWith("test/js/third_party/")
    )
      continue;
    out.push(f);
  }
  return out.sort();
}

/** file -> Set of 1-based line numbers added relative to `base`. */
function addedLines(base: string): Map<string, Set<number>> {
  // Diff from merge-base(base, HEAD) to the *working tree*, so uncommitted
  // edits are covered locally and CI (clean tree) sees the branch's commits.
  const mb = spawnSync("git", ["merge-base", base, "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const from = mb.status === 0 ? mb.stdout.trim() : base;
  const diff = spawnSync("git", ["diff", "--unified=0", "--diff-filter=AM", from, "--", "test/"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const map = new Map<string, Set<number>>();
  if (diff.status !== 0) {
    console.error(`warning: git diff against '${base}' failed; treating all findings as warnings`);
    return map;
  }
  let current: Set<number> | undefined;
  for (const line of diff.stdout.split("\n")) {
    if (line.startsWith("+++ ")) {
      let path = line.slice(4);
      if (path.startsWith("b/")) path = path.slice(2);
      if (path === "/dev/null") {
        current = undefined;
        continue;
      }
      current = new Set();
      map.set(path, current);
    } else if (current && line.startsWith("@@")) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line); // @@ -a[,b] +c[,d] @@
      if (!m) continue;
      const start = parseInt(m[1], 10);
      const count = m[2] ? parseInt(m[2], 10) : 1;
      for (let i = 0; i < count; i++) current.add(start + i);
    }
  }
  return map;
}

// ── scan ────────────────────────────────────────────────────────────────────

interface Finding {
  file: string;
  line: number;
  col: number;
  rule: string;
  why: string;
  text: string;
  error: boolean;
}

const changed = changedBase ? addedLines(changedBase) : undefined;
const started = performance.now();
const findings: Finding[] = [];
let scanned = 0;

for (const file of listTestFiles()) {
  let text: string;
  try {
    text = readFileSync(resolve(ROOT, file), "utf8");
  } catch {
    continue;
  }
  scanned++;
  const lines = text.split("\n");
  const fileAdded = changed?.get(file);
  const state: LineState = { inTemplate: false, inBlockComment: false };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = classify(line, state);
    if (!TRIGGER.test(line) || ALLOW_COMMENT.test(line)) continue;
    for (const rule of rules) {
      const col = rule.match(line, code);
      if (col < 0) continue;
      if (i > 0 && ALLOW_COMMENT.test(lines[i - 1])) continue;
      const error = allErrors || (changed ? !!fileAdded?.has(i + 1) : false);
      findings.push({
        file,
        line: i + 1,
        col: col + 1,
        rule: rule.name,
        why: rule.why,
        text: line.trim().slice(0, 200),
        error,
      });
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────

const elapsed = ((performance.now() - started) / 1000).toFixed(2);
const errors = findings.filter(f => f.error);

if (asJson) {
  console.log(JSON.stringify({ scanned, elapsed: +elapsed, findings }, null, 2));
} else {
  const visible = quiet ? errors : findings;
  for (const f of visible) {
    const level = f.error ? "error" : "warning";
    if (isGithubActions) {
      console.log(`::${level} file=${f.file},line=${f.line},col=${f.col},title=lint-tests/${f.rule}::${f.why}`);
    }
    const tag = f.error ? "\x1b[31merror\x1b[0m" : "\x1b[33mwarning\x1b[0m";
    console.log(`${f.file}:${f.line}:${f.col}: ${tag} [${f.rule}] ${f.why}`);
    console.log(`  ${f.text}`);
  }
  const byRule = new Map<string, number>();
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  const summary = [...byRule.entries()].map(([r, n]) => `${r}: ${n}`).join(", ");
  console.error(
    `\nlint-tests: scanned ${scanned} files in ${elapsed}s; ` +
      `${findings.length} finding(s), ${errors.length} error(s)` +
      (summary ? `  (${summary})` : ""),
  );
  if (errors.length) {
    console.error(`  suppress a finding with \`// lint-tests-allow: <reason>\` on the line above.`);
  }
}

process.exit(errors.length ? 1 : 0);
