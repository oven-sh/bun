#!/usr/bin/env bun
// Regenerates test/no-parallel.txt — the single source of truth for which
// test files must NOT be batched into `bun test --parallel` by
// scripts/runner.node.mjs.
//
// A file is denylisted when:
//   - its path is under napi/, v8/, ffi/, or webview/
//   - its basename contains leak|stress|memory|heap|gc|rss
//   - its body matches any of CONTENT_PATTERNS (GC pressure, RSS measurement,
//     heap snapshots, etc. — anything perturbed by sibling workers)
//
// The node-test tree (js/node/test/{parallel,sequential}/) is NOT listed —
// those run via `bun run`, not `bun test`, so they're excluded structurally
// in the runner regardless of this file.
//
// Run: bun run regenerate-no-parallel

import { Glob } from "bun";
import { join, relative } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const testRoot = join(repoRoot, "test");
const outPath = join(testRoot, "no-parallel.txt");

const PATH_PATTERNS = [/(?:^|\/)(napi|v8|ffi|webview)\//i, /\b(leak|stress|memory|heap|gc|rss)\b/i];

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

// Runs via `bun run`, not `bun test` — structurally excluded by the runner.
function isNodeTestTree(posix: string): boolean {
  return /(^|\/)js\/(node|bun)\/test\/(parallel|sequential)\//.test(posix);
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
  const rel = "test/" + entry.replaceAll("\\", "/");
  if (isNodeTestTree(rel)) continue;
  scanned++;
  const base = rel.split("/").at(-1)!;
  if (PATH_PATTERNS[0].test(rel) || PATH_PATTERNS[1].test(base)) {
    matches.push(rel);
    continue;
  }
  const body = await Bun.file(join(testRoot, entry)).text();
  if (CONTENT_PATTERNS.some(re => re.test(body))) matches.push(rel);
}

matches.sort();
const manual = (await readManualSection()).filter(m => !matches.includes(m));

const header = `# Tests that must NOT run inside the \`bun test --parallel\` batch in CI.
#
# scripts/runner.node.mjs partitions tests into a single \`--parallel\` batch
# (fast path) and a sequential per-file tail. Anything listed here goes to
# the tail because it measures GC/RSS/heap state, loads native addons, or
# otherwise can't tolerate sibling worker processes.
#
# This file is the single source of truth. The runner adds nothing on top
# except the node-test tree (js/node/test/{parallel,sequential}/), which runs
# via \`bun run\` rather than \`bun test\` and so can never join the batch.
#
# REGENERATE: bun run regenerate-no-parallel
# Hand-added entries go below the "# manual" marker so regeneration keeps them.

`;

const body = matches.join("\n");
const manualSection = `\n\n# manual\n${manual.join("\n")}${manual.length ? "\n" : ""}`;

await Bun.write(outPath, header + body + manualSection);

console.log(`scanned ${scanned} test files`);
console.log(`wrote ${matches.length} auto entries + ${manual.length} manual → ${relative(repoRoot, outPath)}`);
