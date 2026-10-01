// Scratch: a subset of the small corpus for a run with a debug binary: every source a cause can be about, and a sample of the rest.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { M, loadJsonl, loadRun, valueOf } from "./lib.mjs";
import { tagOf, metadataCalls } from "/workspace/notes/lint/units/parser/probes/metadata.mjs";
const base = loadRun(`${M}/base.small.jsonl.gz`);
const oracle = new Map(loadJsonl(`/tmp/gdo/oracle2.small.jsonl.gz`).slice(1).map(r => [r.src, r]));
const pick = new Map();
const byKey = list => { const m = {}; for (const [k, v] of list) (m[k] ??= []).push(tagOf(v)); return m; };
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (const [src, rec] of base.records) {
  const o = oracle.get(src);
  let why = null;
  for (const api of base.header.apis) {
    const v = valueOf(base, rec, api);
    if (v[0] === "e" && o[api.includes(".tsx.") ? "tsx" : "ts"].length === 0) { why = "S1"; break; }
  }
  if (!why && src.includes("@")) {
    const v = valueOf(base, rec, "t.ts.deco");
    const tsc = o.metaLoose ?? o.meta;
    if (v[0] === "o" && tsc && JSON.stringify(byKey(metadataCalls(v[1]))) !== JSON.stringify(byKey(tsc))) why = "S2";
  }
  if (!why) {
    const accepted = valueOf(base, rec, "t.ts.plain")[0] === "o";
    if (accepted ? rand() < 1500 / 58000 : rand() < 500 / 147000) why = accepted ? "S3a" : "S3r";
  }
  if (why) pick.set(src, why);
}
const count = {};
for (const w of pick.values()) count[w] = (count[w] ?? 0) + 1;
console.log(pick.size, "sources", count);
const sources = [...pick.keys()].map(src => ({ prod: base.records.get(src).prod, src }));
writeFileSync("/tmp/gdo/gd/corpus.small-sub.json", JSON.stringify({ name: "small-sub", contexts: {}, forms: [], sources }));
// the base run and the oracle, cut to the same sources
const lines = [JSON.stringify({ ...base.header, corpus: "small-sub", count: pick.size })];
for (const [src, rec] of base.records) if (pick.has(src)) lines.push(JSON.stringify(rec));
writeFileSync("/tmp/gdo/gd/base.small-sub.jsonl.gz", gzipSync(lines.join("\n") + "\n"));
const olines = [JSON.stringify({ header: 1, version: "6.0.2", revision: "tsc", corpus: "small-sub", count: pick.size, apis: [] })];
for (const src of pick.keys()) olines.push(JSON.stringify(oracle.get(src)));
writeFileSync("/tmp/gdo/gd/oracle.small-sub.jsonl.gz", gzipSync(olines.join("\n") + "\n"));
