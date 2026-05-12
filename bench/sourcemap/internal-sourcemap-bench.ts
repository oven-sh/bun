// Microbench for the InternalSourceMap stack-trace remapping path. Compare
// against a baseline build by running:
//
//   bun run build:release bench/sourcemap/internal-sourcemap-bench.ts
//
// On first run this generates a ~150k-line .ts module next to this file so the
// stack frames being remapped live inside a large SavedSourceMap entry.

import fs from "node:fs";
import path from "node:path";

const ITER = 10_000;
const BIG_LINES = 150_000;

const flag = process.argv[2] ?? "bench";
const mb = (n: number) => (n / 1048576).toFixed(2) + " MB";

const bigPath = path.join(import.meta.dir, "big-module.generated.ts");
if (!fs.existsSync(bigPath)) {
  let src = "let v: number = 0;\n";
  for (let i = 0; i < BIG_LINES; i++) src += `v = (v + ${i % 97}) | 0;\n`;
  src += "export function go(): string { return new Error('e').stack!; }\n";
  fs.writeFileSync(bigPath, src);
}

const rssBefore = process.memoryUsage().rss;
const tLoad0 = performance.now();
const { go } = require(bigPath) as { go: () => string };
const tLoad1 = performance.now();
const rssAfterLoad = process.memoryUsage().rss;

// First .stack: triggers full VLQ decode in the old path.
const tFirst0 = performance.now();
let s = go();
const tFirst1 = performance.now();
const rssAfterFirst = process.memoryUsage().rss;

const t0 = performance.now();
for (let i = 0; i < ITER; i++) s = go();
const t1 = performance.now();
const rssAfterLoop = process.memoryUsage().rss;

console.log(`[${flag}] load big module:          ${(tLoad1 - tLoad0).toFixed(2)} ms`);
console.log(`[${flag}] first new Error().stack:  ${(tFirst1 - tFirst0).toFixed(3)} ms`);
console.log(
  `[${flag}] ${ITER}x new Error().stack: ${(t1 - t0).toFixed(2)} ms (${(((t1 - t0) * 1000) / ITER).toFixed(2)} µs/op)`,
);
console.log(
  `[${flag}] rss before/afterLoad/afterFirst/afterLoop: ${mb(rssBefore)} / ${mb(rssAfterLoad)} / ${mb(rssAfterFirst)} / ${mb(rssAfterLoop)}`,
);
console.log(`[${flag}] rss delta load→firstStack: ${mb(rssAfterFirst - rssAfterLoad)}`);
void s;
