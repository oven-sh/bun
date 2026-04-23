#!/usr/bin/env bun
// Regenerates test/no-parallel.txt — the denylist of test files that must NOT
// be batched into `bun test --parallel` by scripts/runner.node.mjs.
//
// A file is denylisted when its body matches any of CONTENT_PATTERNS below
// (GC pressure, RSS measurement, heap snapshots, etc. — anything whose result
// is perturbed by other workers sharing the machine).
//
// Path-based excludes (napi/, v8/, leak/stress/memory in basename, node-test
// tree) are applied directly in the runner, NOT listed here, so this file
// stays focused on the content-derived cases that aren't visible from the
// path alone.
//
// Run: bun run regenerate-no-parallel
//   or: bun scripts/generate-no-parallel.ts

import { Glob } from "bun";
import { join, relative } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const testRoot = join(repoRoot, "test");
const outPath = join(testRoot, "no-parallel.txt");

const CONTENT_PATTERNS = [
  /\bexpectMaxObjectTypeCount\b/,
  /\bBun\.gc\s*\(/,
  /\bgcTick\b/,
  /\bheapStats\b/,
  /\bgenerateHeapSnapshot\b/,
  /\bprocess\.memoryUsage\b/,
  /\bBun\.WebView\b/,
  /\.rss\b/,
  /\bheapUsed\b/,
  /\bwithoutAggressiveGC\b/,
  /BUN_JSC_forceRAMSize/,
];

// These are already excluded by isParallelSafe() in the runner via path
// match — listing them here would just be noise.
function isPathExcludedByRunner(p: string): boolean {
  const posix = p.replaceAll("\\", "/");
  if (/\/(napi|v8|ffi|webview)\//i.test(posix)) return true;
  if (/(^|\/)js\/node\/test\/(parallel|sequential)\//.test(posix)) return true;
  if (/\b(leak|stress|memory|heap|gc|rss)\b/i.test(posix.split("/").at(-1)!)) return true;
  return false;
}

// Preserve hand-added entries that the grep wouldn't rediscover. Anything
// after a line containing just `# manual` in the existing file is kept.
async function readManualSection(): Promise<string[]> {
  const f = Bun.file(outPath);
  if (!(await f.exists())) return [];
  const text = await f.text();
  const idx = text.indexOf("\n# manual");
  if (idx === -1) return [];
  return text
    .slice(idx)
    .split("\n")
    .slice(1)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));
}

const glob = new Glob("**/*.{test,spec}.{ts,tsx,js,mjs,cjs,jsx,mts,cts}");
const matches: string[] = [];
let scanned = 0;

for await (const entry of glob.scan({ cwd: testRoot, onlyFiles: true })) {
  if (entry.includes("node_modules")) continue;
  scanned++;
  const rel = "test/" + entry.replaceAll("\\", "/");
  if (isPathExcludedByRunner(rel)) continue;
  const body = await Bun.file(join(testRoot, entry)).text();
  if (CONTENT_PATTERNS.some(re => re.test(body))) {
    matches.push(rel);
  }
}

matches.sort();
const manual = (await readManualSection()).filter(m => !matches.includes(m));

const header = `# Tests that must NOT run inside the \`bun test --parallel\` batch in CI.
#
# scripts/runner.node.mjs partitions tests into a single \`--parallel\` batch
# (fast path) and a sequential per-file tail. Anything listed here goes to
# the tail because it measures GC/RSS/heap state that other workers would
# perturb, or otherwise can't tolerate sibling processes.
#
# Path-based excludes (napi/, v8/, ffi/, webview/, node-test tree, and any
# file whose basename contains leak/stress/memory/heap/gc/rss) are applied
# in the runner and intentionally NOT repeated here.
#
# REGENERATE: bun run regenerate-no-parallel
# Hand-added entries go below the "# manual" marker so regeneration keeps them.

`;

const body = matches.join("\n");
const manualSection = `\n\n# manual\n${manual.join("\n")}${manual.length ? "\n" : ""}`;

await Bun.write(outPath, header + body + manualSection);

console.log(`scanned ${scanned} test files`);
console.log(`wrote ${matches.length} auto entries + ${manual.length} manual → ${relative(repoRoot, outPath)}`);
