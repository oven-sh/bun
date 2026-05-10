#!/usr/bin/env bun
// Categorize CI failures from build #52975 into a markdown doc with isolated
// context per failure, suitable for dispatching a fleet of fixers.

import { createReadStream, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

const BUILD = process.argv[2] ?? "52975";
const DIR = join(process.cwd(), `tmp/ci-${BUILD}`);
const OUT = join(DIR, "FAILURES.md");

type Platform = string;

interface TestFailure {
  file: string;
  /** normalized signature, e.g. "SIGABRT", "unchecked exception at X", "code 1", "timeout" */
  sig: string;
  /** raw reason strings seen, per platform */
  rawReasons: Map<Platform, string>;
  /** trimmed context (last attempt) — store the shortest one to keep doc readable */
  context: string;
  contextLen: number;
  platforms: Set<Platform>;
}

interface BuildFailure {
  job: string;
  context: string;
}

// ---------------------------------------------------------------------------

const dockerNoise =
  /^(\[\+\] up |\s*[⠁⠂⠄⡀⢀⠠⠐⠈⠇⠋⠏⠙⠹⠸⠼⠴⠦⠧⠉⠓⠒]\s|\s*✔ (Network|Container)|WebSocket (opened|closed)$| {2}at .*node_modules\/)/u;
const ansi = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s: string) {
  return s.replace(ansi, "");
}

function normalizeReason(raw: string): string {
  raw = raw.trim();
  // unchecked exception at <site> @ file:line (thrown from ...)
  let m = raw.match(/^unchecked exception at (.+?) @ (\S+?):\d+/);
  if (m) {
    const file = m[2].replace(/^.*\/build\/[^/]+\/codegen\//, "<codegen>/");
    return `unchecked exception at ${m[1]} @ ${file}`;
  }
  m = raw.match(/^(SIG[A-Z]+)/i);
  if (m) return m[1].toUpperCase();
  m = raw.match(/^code (\d+)/);
  if (m) return `exit code ${m[1]}`;
  if (/segmentation fault/i.test(raw)) return "SIGSEGV";
  if (/timeout/i.test(raw)) return "timeout";
  if (/^panic/.test(raw)) {
    // panic: message ... — keep first 80 chars of message sans addresses
    const msg = raw
      .replace(/^panic:?\s*/i, "")
      .replace(/0x[0-9a-fA-F]+/g, "0xADDR")
      .replace(/\b\d{5,}\b/g, "NNN");
    return `panic: ${msg.slice(0, 100)}`;
  }
  // pid NNN error: addresssanitizer ...
  m = raw.match(/^pid \d+ (.+)/);
  if (m) raw = m[1];
  // assertion / debug assert
  if (/assert/i.test(raw)) {
    return raw.replace(/:\d+/g, ":L").slice(0, 120);
  }
  return raw.replace(/:\d+\b/g, ":L").slice(0, 120);
}

/**
 * Mine the captured context for a more specific root-cause signature than the
 * runner's summary line gives us. SIGABRT alone is useless; "panic @
 * src/runtime/server/mod.rs — already borrowed" is gold.
 *
 * Only refines GENERIC base sigs (SIGABRT/SIGSEGV/exit code/crash/asan). The
 * unchecked-exception sigs already carry source location — keep those.
 */
function refineSignature(baseSig: string, ctx: string[]): string {
  const generic = /^(SIG[A-Z]+|exit code|crash|timeout|error: addresssanitizer)/i.test(baseSig);
  if (!generic) return baseSig;

  const text = ctx.map(stripAnsi);
  const findIdx = (re: RegExp) => {
    for (let i = text.length - 1; i >= 0; i--) if (re.test(text[i])) return i;
    return -1;
  };
  const find = (re: RegExp) => {
    for (let i = text.length - 1; i >= 0; i--) {
      const m = re.exec(text[i]);
      if (m) return m;
    }
    return null;
  };
  const shortPath = (p: string) =>
    p.replace(/^.*\/(src|crates|packages|library)\//, "$1/").replace(/^\/rustc\/[a-f0-9]+\//, "rustc/");

  // Rust panic — modern format puts message on the next line:
  //   thread '<name>' (pid) panicked at path/to/file.rs:L:C:
  //   <message>
  // Subprocess stderr may prefix lines with `+ `, `dev| `, `> ` etc.
  const stripPrefix = (s: string) => s.replace(/^(?:\+ |dev\| |> |\| )+/, "");
  let i = findIdx(/panicked at .*\.rs:\d+:\d+:?/);
  if (i >= 0) {
    const m = /panicked at (?:'.*?', )?(.+?\.rs):(\d+):\d+/.exec(text[i])!;
    // Next non-noise line is the message; skip ✗/::error/note: lines.
    let msg = "";
    for (let j = i + 1; j < Math.min(i + 6, text.length); j++) {
      const cand = stripPrefix(text[j]).trim();
      if (!cand || /^(?:✗|\(fail\)|::error|note: run with|stack backtrace)/.test(cand)) continue;
      msg = cand;
      break;
    }
    msg = msg
      .replace(/0x[0-9a-fA-F]+/g, "0xADDR")
      .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "")
      .replace(/\b\d{4,}\b/g, "N")
      .replace(/\s+/g, " ")
      .slice(0, 90);
    return `panic @ ${shortPath(m[1])}:${m[2]} — ${msg || "?"}`.trimEnd();
  }
  // ASAN error (NOT the SUMMARY-of-leaks line, which has digits where we want a word)
  let m = find(/ERROR: AddressSanitizer: ([a-zA-Z][\w-]*)/);
  if (m) {
    const fr = find(/#\d+ 0x[0-9a-f]+ (?:in )?(\S+) .*?([\w./-]+\.(?:rs|cpp|c|h)):\d+/);
    return `ASAN ${m[1]}${fr ? ` in ${fr[1]} @ ${fr[2].split("/").slice(-2).join("/")}` : ""}`;
  }
  // LeakSanitizer — don't bucket by byte count, that just fragments
  if (findIdx(/LeakSanitizer: detected memory leaks/) >= 0) {
    return "LeakSanitizer: memory leak";
  }
  // C++ ASSERTION FAILED (JSC-style)
  m = find(/ASSERTION FAILED: (.+)/);
  if (m) return `JSC assert: ${m[1].slice(0, 90)}`;
  // Rust assertion macro
  m = find(/assertion (?:`left == right`|failed)[:!]?\s*(.*)/);
  if (m) return `assertion failed${m[1] ? `: ${m[1].slice(0, 80)}` : ""}`;
  // unreachable / not yet implemented
  m = find(/internal error: entered unreachable code(?:: (.+))?/);
  if (m) return `unreachable${m[1] ? `: ${m[1].slice(0, 80)}` : ""}`;
  m = find(/not yet implemented(?:: (.+))?/);
  if (m) return `todo!${m[1] ? `: ${m[1].slice(0, 80)}` : ""}`;
  // exit code 1: keep base — context already has the test failure detail
  return baseSig;
}

function trimContext(lines: string[], maxLines = 120): string {
  // Filter docker/compose progress noise & blank repeats, then keep tail
  const out: string[] = [];
  let lastBlank = false;
  for (const line of lines) {
    const s = stripAnsi(line);
    if (dockerNoise.test(s)) continue;
    const blank = s.trim() === "";
    if (blank && lastBlank) continue;
    lastBlank = blank;
    out.push(s);
  }
  // Find the "interesting" anchor (panic/ASAN/error) and center the window on it
  // instead of blindly head+tailing — otherwise LeakSanitizer SUMMARY etc. gets cut.
  let anchor = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (
      /panicked at|AddressSanitizer:|LeakSanitizer:|SUMMARY:|^error:|assertion fail|^✗ |^\(fail\)|stack backtrace:|unreachable/i.test(
        out[i],
      )
    ) {
      anchor = i;
      break;
    }
  }
  if (out.length > maxLines) {
    if (anchor >= 0) {
      const lo = Math.max(0, anchor - 20);
      const hi = Math.min(out.length, lo + maxLines);
      const parts: string[] = [];
      if (lo > 0) parts.push(out[0], `... (${lo - 1} lines omitted) ...`);
      parts.push(...out.slice(lo, hi));
      if (hi < out.length) parts.push(`... (${out.length - hi} lines omitted) ...`, out[out.length - 1]);
      return parts.join("\n");
    }
    const head = out.slice(0, 12);
    const tail = out.slice(-maxLines + 14);
    return [...head, `... (${out.length - maxLines + 2} lines omitted) ...`, ...tail].join("\n");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------

const startRe = /^--- \[(\d+)\/(\d+)\] (\S+?)(?: \[attempt #\d+\])?$/;
const resultRe = /^--- \[(\d+)\/(\d+)\] (\S+?) - (.+)$/;

async function processTestLog(path: string, platform: Platform, failures: Map<string, TestFailure>) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let curFile: string | null = null;
  let curBuf: string[] = [];
  let bufCap = 4000; // hard cap to avoid memory blowup on huge spammy tests

  for await (const rawLine of rl) {
    const line = stripAnsi(rawLine);
    let m = resultRe.exec(line);
    if (m) {
      const [, , , file, reason] = m;
      // record failure
      const baseSig = normalizeReason(reason);
      const sig = refineSignature(baseSig, curBuf);
      const key = `${file}\x00${sig}`;
      const ctx = trimContext(curBuf);
      let f = failures.get(key);
      if (!f) {
        f = {
          file,
          sig,
          rawReasons: new Map(),
          context: ctx,
          contextLen: ctx.length,
          platforms: new Set(),
        };
        failures.set(key, f);
      } else if (ctx.length > 100 && ctx.length < f.contextLen) {
        // prefer the most concise non-trivial context
        f.context = ctx;
        f.contextLen = ctx.length;
      } else if (f.contextLen < 100 && ctx.length > f.contextLen) {
        f.context = ctx;
        f.contextLen = ctx.length;
      }
      f.platforms.add(platform);
      if (!f.rawReasons.has(platform)) f.rawReasons.set(platform, reason);
      // result line ends this test; next line should be a new start or attempt
      curFile = null;
      curBuf = [];
      continue;
    }
    m = startRe.exec(line);
    if (m) {
      curFile = m[3];
      curBuf = [];
      continue;
    }
    if (curFile && curBuf.length < bufCap) {
      curBuf.push(rawLine);
    }
  }
}

// ---------------------------------------------------------------------------

async function processBuildLog(path: string): Promise<string> {
  const text = await Bun.file(path).text();
  const lines = text.split("\n").map(stripAnsi);
  // Find the first REAL error marker (not "🚨 Error: command exited" tail noise).
  // Prefer: rustc error[E…], cargo "error:", ld.lld/rust-lld, VIOLATIONS, "FAILED:".
  const isRealErr = (l: string) =>
    /^error\[E\d+\]|^error: (?!The command exited|script )|^(?:ld\.lld|rust-lld): error|^VIOLATIONS|^\s*FAILED:|undefined symbol|unsupported CPU|panicked at/.test(
      l,
    );
  let startIdx = lines.findIndex(isRealErr);
  if (startIdx < 0) startIdx = Math.max(0, lines.length - 80);
  else startIdx = Math.max(0, startIdx - 3);
  // End at the buildkite "🚨 Error" / "user command error" trailer if present.
  let endIdx = lines.findIndex((l, i) => i > startIdx && /^(?:🚨 Error|user command error|~~~ Running)/.test(l));
  if (endIdx < 0) endIdx = lines.length;
  let slice = lines.slice(startIdx, endIdx);
  // Hard cap, but keep head (where rustc errors live) rather than tail-anchoring.
  const MAX = 150;
  if (slice.length > MAX) {
    slice = [...slice.slice(0, MAX - 10), `... (${slice.length - MAX} lines omitted) ...`, ...slice.slice(-9)];
  }
  return slice.join("\n");
}

// ---------------------------------------------------------------------------

const files = readdirSync(DIR)
  .filter(f => f.endsWith(".log"))
  .map(f => join(DIR, f));

const testLogs = files.filter(f => /---test-bun(-\d+)?\.log$/.test(f));
const buildLogs = files.filter(f => /---(build-(bun|rust)|verify-baseline)(-\d+)?\.log$/.test(f));

console.error(`Processing ${testLogs.length} test logs, ${buildLogs.length} build logs...`);

const failures = new Map<string, TestFailure>();

for (const log of testLogs) {
  const plat = basename(log).replace(/---test-bun(-\d+)?\.log$/, "");
  const sz = (statSync(log).size / 1e6).toFixed(0);
  console.error(`  [${sz}MB] ${plat}`);
  await processTestLog(log, plat, failures);
}

const buildFails: BuildFailure[] = [];
for (const log of buildLogs) {
  const job = basename(log)
    .replace(/\.log$/, "")
    .replace(/---/g, " — ");
  buildFails.push({ job, context: await processBuildLog(log) });
}

// ---------------------------------------------------------------------------
// Secondary grouping: cluster test failures by signature so fixers can attack
// root causes (one fix → many tests).

const bySig = new Map<string, TestFailure[]>();
for (const f of failures.values()) {
  const list = bySig.get(f.sig) ?? [];
  list.push(f);
  bySig.set(f.sig, list);
}
const sigEntries = [...bySig.entries()].sort((a, b) => b[1].length - a[1].length);

// ---------------------------------------------------------------------------
// Emit markdown

let md = "";
const w = (s = "") => (md += s + "\n");

w(`# CI Failure Categorization — build #${BUILD}`);
w();
w(`Branch: \`claude/phase-a-port\` · https://buildkite.com/bun/bun/builds/${BUILD}`);
w(`Generated: ${new Date().toISOString()}`);
w();
w(
  `**Summary:** ${buildFails.length} build/link/verify failures · ${failures.size} unique (test-file × signature) test failures across ${sigEntries.length} root-cause signatures.`,
);
w();
w(
  `Each entry below is self-contained: a fixer agent can read just that section and have enough context to reproduce + fix.`,
);
w();

// --- TOC
w(`## Index`);
w();
w(`### Build / link / verify`);
for (const b of buildFails) w(`- [\`${b.job}\`](#build-${slug(b.job)})`);
w();
w(`### Test failures by root-cause signature (most common first)`);
for (const [sig, list] of sigEntries) {
  w(`- **${list.length}×** [${escapeMd(sig)}](#sig-${slug(sig)})`);
}
w();
w(`---`);
w();

// --- Build failures
w(`## Build / link / verify failures`);
w();
for (const b of buildFails) {
  w(`<a id="build-${slug(b.job)}"></a>`);
  w(`### ${b.job}`);
  w();
  w(`**Repro:** \`bk job log <uuid> -b ${BUILD}\` or see \`tmp/ci-${BUILD}/${b.job.replace(/ — /g, "---")}.log\``);
  w();
  w("```text");
  w(b.context);
  w("```");
  w();
}

w(`---`);
w();

// --- Test failures grouped by signature
w(`## Test failures`);
w();
for (const [sig, list] of sigEntries) {
  list.sort((a, b) => a.file.localeCompare(b.file));
  w(`<a id="sig-${slug(sig)}"></a>`);
  w(`### Signature: \`${escapeMd(sig)}\` (${list.length} test file${list.length === 1 ? "" : "s"})`);
  w();
  if (list.length > 1) {
    w(`Affected files:`);
    for (const f of list) w(`- \`${f.file}\` — ${platList(f.platforms)}`);
    w();
  }
  for (const f of list) {
    w(`#### \`${f.file}\``);
    w();
    w(`- **Signature:** \`${escapeMd(f.sig)}\``);
    const raws = new Set(f.rawReasons.values());
    if (raws.size > 1 || [...raws][0] !== f.sig) {
      w(`- **Raw reason(s):** ${[...raws].map(r => "`" + escapeMd(r) + "`").join(" · ")}`);
    }
    w(`- **Platforms:** ${platList(f.platforms)}`);
    w(`- **Repro:** \`bun bd test ${f.file}\``);
    w();
    w(`<details><summary>Log context (last attempt)</summary>`);
    w();
    w("```text");
    w(f.context);
    w("```");
    w();
    w(`</details>`);
    w();
  }
  w(`---`);
  w();
}

await Bun.write(OUT, md);
console.error(`\nWrote ${OUT} (${(md.length / 1e6).toFixed(2)} MB, ${md.split("\n").length} lines)`);

// --- Per-task shards + JSON manifest for fleet dispatch -------------------
const taskDir = join(DIR, "tasks");
await Bun.$`rm -rf ${taskDir} && mkdir -p ${taskDir}`.quiet();

const manifest: Array<{
  id: string;
  kind: "build" | "test";
  signature: string;
  files: string[];
  platforms: string[];
  task_file: string;
  repro: string;
}> = [];

let n = 0;
for (const b of buildFails) {
  const id = `B${String(++n).padStart(3, "0")}`;
  const fp = join(taskDir, `${id}-${slug(b.job)}.md`);
  await Bun.write(
    fp,
    `# ${id} — Build failure: ${b.job}\n\nBuild #${BUILD} · https://buildkite.com/bun/bun/builds/${BUILD}\n\n## Log\n\n\`\`\`text\n${b.context}\n\`\`\`\n\n## Goal\n\nFix the build/link error above. Relevant log on disk: \`tmp/ci-${BUILD}/${b.job.replace(/ — /g, "---")}.log\`\n`,
  );
  manifest.push({
    id,
    kind: "build",
    signature: b.job,
    files: [],
    platforms: [b.job.split(" — ")[0]],
    task_file: fp,
    repro: "",
  });
}

// Signatures that point at a specific source location share a root cause →
// one task. Generic signatures (exit code N, bare SIG*, timeout, "crash") are
// per-test bugs → split per file so each fixer gets one isolated unit.
const isGenericSig = (s: string) => /^(exit code|SIG[A-Z]+$|timeout$|crash)/i.test(s);

n = 0;
const emitTask = async (sig: string, list: TestFailure[], hint: string) => {
  const id = `T${String(++n).padStart(3, "0")}`;
  const fp = join(taskDir, `${id}-${slug(sig)}.md`);
  list.sort((a, b) => a.file.localeCompare(b.file));
  const allPlats = new Set<string>();
  for (const f of list) for (const p of f.platforms) allPlats.add(p);
  let body = `# ${id} — ${sig}\n\nBuild #${BUILD} · ${list.length} test file(s) · platforms: ${[...allPlats].sort().join(", ")}\n\n`;
  if (list.length > 1) {
    body += `## Affected test files\n\n`;
    for (const f of list) body += `- \`${f.file}\` (${platList(f.platforms)})\n`;
  }
  body += `\n## Repro\n\n\`\`\`sh\nbun bd test ${list[0].file}\n\`\`\`\n\n## Isolated log context\n\n`;
  // For very large clusters, only embed the first 8 contexts to keep task files
  // tractable; the full list is in FAILURES.md.
  const sample = list.slice(0, 8);
  for (const f of sample) {
    body += `### \`${f.file}\`\n\nRaw reason: \`${[...new Set(f.rawReasons.values())].join("` · `")}\`\n\n\`\`\`text\n${f.context}\n\`\`\`\n\n`;
  }
  if (list.length > sample.length)
    body += `_(+${list.length - sample.length} more files with same signature — see FAILURES.md)_\n\n`;
  body += `## Goal\n\n${hint}\n`;
  await Bun.write(fp, body);
  manifest.push({
    id,
    kind: "test",
    signature: sig,
    files: list.map(f => f.file),
    platforms: [...allPlats].sort(),
    task_file: fp,
    repro: `bun bd test ${list[0].file}`,
  });
};

for (const [sig, list] of sigEntries) {
  if (isGenericSig(sig)) {
    // split per-file
    for (const f of list) {
      await emitTask(
        `${sig} — ${f.file}`,
        [f],
        `This test exits non-zero / crashes without a categorizable runtime signature. Root-cause the assertion/behavior failure in the test output above and fix the underlying Rust port logic.`,
      );
    }
  } else {
    await emitTask(
      sig,
      list,
      `All ${list.length} test(s) above share this crash signature. The fix almost certainly lives in the Rust runtime at the location named in the signature, not in the tests. Fix once, then re-run a sample of the affected tests.`,
    );
  }
}

await Bun.write(join(DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
console.error(`Wrote ${manifest.length} task files to ${taskDir}/ + manifest.json`);
console.error(`\nTop signatures:`);
for (const [sig, list] of sigEntries.slice(0, 15)) {
  console.error(`  ${String(list.length).padStart(4)}× ${sig}`);
}

// ---------------------------------------------------------------------------

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
function escapeMd(s: string) {
  return s.replace(/([`|*_])/g, "\\$1");
}
function platList(p: Set<string>) {
  return [...p].sort().join(", ");
}
