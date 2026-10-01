// bun cold-reads.ts <H>: the files that the test file reads once the whole enumeration has left it, phase by phase, with the
// wall time of each phase: the walk of the cases, the cases of one in 40 and of one in 250, the list, the names and the sample
// of the error baselines. Run it after evict.py for the cold numbers and once more for the warm ones.
import { readFileSync, readdirSync } from "node:fs";
const H = require("node:path").resolve(process.argv[2]);
const { listErrorBaselines, sampleErrorBaselines } = await import(`${H}/runner/roundtrip.ts`);
const corpus = `${H}/corpus`;
const sampled = (name: string, n: number) => Bun.hash.crc32(name) % n === 0;
let last = performance.now();
const phase = (label: string, n: number) => {
  const now = performance.now();
  console.log(`${label.padEnd(58)} ${String(n).padStart(6)} ${(now - last).toFixed(0).padStart(6)} ms`);
  last = now;
};
const cases: string[] = [];
let directories = 0;
const walk = (rel: string) => {
  directories++;
  for (const entry of readdirSync(`${corpus}/cases/${rel}`, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
    else if (/\.tsx?$/.test(entry.name)) cases.push(`${rel}/${entry.name}`);
  }
};
walk("compiler");
walk("conformance");
phase(`the walk of ${directories} directories of cases`, cases.length);
const one40 = cases.filter(p => sampled(p, 40));
for (const p of one40) readFileSync(`${corpus}/cases/${p}`);
phase("the cases of one in 40, read", one40.length);
const one250 = cases.filter(p => sampled(p, 250));
for (const p of one250) readFileSync(`${corpus}/cases/${p}`);
phase("the cases of one in 250, read", one250.length);
readFileSync(`${H}/fixtures/instances.tsv`);
readFileSync(`${H}/fixtures/directives-inputs.json`);
readFileSync(`${H}/fixtures/directives-expected.json`);
phase("the list and the vectors, read", 3);
const all = [
  ...listErrorBaselines(`${corpus}/baselines/typescript`, "typescript"),
  ...listErrorBaselines(`${corpus}/baselines/typescript-go/compiler`, "typescript-go"),
  ...listErrorBaselines(`${corpus}/baselines/typescript-go/conformance`, "typescript-go"),
];
phase("the names of the error baselines", all.length);
const sample = sampleErrorBaselines(all, 200, { maxBytes: 64 * 1024 });
phase("the sample of the error baselines (it asks for sizes)", sample.length);
for (const f of sample) readFileSync(f.path);
phase("the sample of the error baselines, read", sample.length);
