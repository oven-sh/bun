// Builds corpus.check.json: every source that differs between base and head in the two corpora, every targeted source,
// the lines of the probe files t*.txt, and a fixed sample of the small sources that do not differ.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { expand } from "/tmp/gdr1a/gd/harness.mjs";
const R = "/tmp/gdr1a/runs";
const differing = new Set();
for (const f of ["diff.head.small.jsonl", "diff.head.targeted.jsonl"]) for (const l of readFileSync(`${R}/${f}`, "utf8").split("\n")) if (l) differing.add(JSON.parse(l).src);
const sources = new Map();
const add = (src, prod) => { if (!sources.has(src)) sources.set(src, { src, prod }); };
const small = expand(JSON.parse(readFileSync("/tmp/gdr1a/gd/corpus.small.json", "utf8")));
const targeted = expand(JSON.parse(readFileSync("/tmp/gdr1a/gd/corpus.targeted.json", "utf8")));
for (const s of targeted) add(s.src, "targeted:" + s.prod);
let n = 0;
for (const s of small) if (differing.has(s.src)) { add(s.src, `small:${s.ctx}:${s.prod}`); n++; }
let state = 12345, sampled = 0;
for (const s of small) { state = (state * 1103515245 + 12345) & 0x7fffffff; if (!differing.has(s.src) && state % 33 === 0) { add(s.src, `sample:${s.ctx}:${s.prod}`); sampled++; } }
let probes = 0;
for (const f of readdirSync("/tmp/gdr1a/an").filter(f => /^t\d+\.txt$/.test(f)).sort()) for (const line of readFileSync(`/tmp/gdr1a/an/${f}`, "utf8").split("\n")) if (line && !line.startsWith("# ")) { add(line.replaceAll("\u23ce", "\n"), "probe:" + f); probes++; }
writeFileSync("/tmp/gdr1a/runs/corpus.check.json", JSON.stringify({ name: "check", contexts: {}, forms: [], sources: [...sources.values()] }));
console.log(`corpus.check.json: ${sources.size} sources (${targeted.length} targeted, ${n} differing small, ${sampled} sampled small, ${probes} probe lines)`);
