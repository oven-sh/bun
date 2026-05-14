#!/usr/bin/env bun
/**
 * Parse a CI test-bun job log into the results-JSON format that
 * `phase-h-windows-testfix.workflow.js` consumes (same shape as
 * `runner.node.mjs --results-json`).
 *
 *   bun scripts/ci-log-to-results-json.ts <log-path> [out-json]
 *
 * The runner emits per-test blocks delimited by `--- {testPath} ---` and a
 * trailing summary line `# {pass|fail|...} {testPath}`. We capture stdout
 * between markers as `stdoutPreview` and derive `error` from the first
 * panic/crash/unchecked-exception line.
 */

import { readFileSync, writeFileSync } from "node:fs";

const LOG = Bun.argv[2];
const OUT = Bun.argv[3] ?? LOG.replace(/\.log$/, ".results.json");
if (!LOG) throw new Error("usage: ci-log-to-results-json.ts <log-path> [out-json]");

const raw = readFileSync(LOG, "utf8");
// Strip ANSI escape codes — CI logs are colourised.
const text = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

type Result = {
  testPath: string;
  ok: boolean;
  status: string;
  error: string;
  exitCode: number | null;
  stdoutPreview: string;
};

const results: Result[] = [];

// Runner block format (per test/runners/runner.node.mjs CI mode):
//   --- [N/TOTAL] <testPath>
//   <bun test stdout/stderr ...>
//   <N> pass
//   <N> fail
//   Ran <N> tests across <N> file. [<dur>]
const blockRe = /^--- \[\d+\/\d+\] (.+?)$/gm;
const splits: Array<{ testPath: string; start: number; headerStart: number }> = [];
let m;
while ((m = blockRe.exec(text))) {
  splits.push({ testPath: m[1].trim(), start: m.index + m[0].length, headerStart: m.index });
}
for (let i = 0; i < splits.length; i++) {
  const { testPath, start } = splits[i];
  const end = i + 1 < splits.length ? splits[i + 1].headerStart : text.length;
  const body = text.slice(start, end);

  // Skip non-test blocks (package.json install steps).
  if (!/\.test\.(ts|js|tsx|mjs|cjs)$/.test(testPath)) continue;

  // bun-test summary lines.
  const passMatch = body.match(/^\s*(\d+)\s+pass\s*$/m);
  const failMatch = body.match(/^\s*(\d+)\s+fail\s*$/m);
  const failCount = failMatch ? parseInt(failMatch[1], 10) : null;
  const passCount = passMatch ? parseInt(passMatch[1], 10) : null;
  let status: string;
  if (failCount === null && passCount === null) {
    // No summary → process crashed/timed out before bun-test could print one.
    status = /SIGKILL|timeout|timed out/i.test(body) ? "timeout" : "crash";
  } else if ((failCount ?? 0) > 0) {
    status = "fail";
  } else {
    status = "pass";
  }
  const ok = status === "pass";

  // Extract first distinctive error line for the signature.
  let error = "";
  const errLine = body.match(
    /^.*?(panicked at|panic:|Segmentation fault|SIGSEGV|SIGABRT|SIGBUS|unchecked exception|ASSERTION FAILED|heap-use-after-free|heap-buffer-overflow|thread '.*' panicked|error: expect\(|error:).*$/m,
  );
  if (errLine) error = errLine[0].slice(0, 300);

  const exitMatch = body.match(/exitCode[=: ](-?\d+)/);
  const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;

  // Keep last 4k of body as preview (the interesting bit is usually at the end).
  const stdoutPreview = body.length > 4000 ? body.slice(-4000) : body;

  results.push({ testPath, ok, status, error, exitCode, stdoutPreview });
}

const failed = results.filter(r => !r.ok);
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.error(`${results.length} tests parsed (${failed.length} failed) → ${OUT}`);
