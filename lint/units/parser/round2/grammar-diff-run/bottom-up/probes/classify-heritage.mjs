import { readFileSync } from "node:fs";
import { load, acc, msg, tscState } from "./lib.mjs";
const R = "/tmp/gdr1a/runs";
const base = load(`${R}/base.small.jsonl.gz`), head = load(`${R}/head.small.jsonl.gz`), oracle = load(`${R}/oracle.small.jsonl.gz`);
const corpus = JSON.parse(readFileSync("/tmp/gdr1a/gd/corpus.small.json", "utf8"));
const ctxs = corpus.contexts;
const rows = readFileSync("forbidden.small.jsonl", "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const byForm = new Map();
for (const r of rows) { if (!byForm.has(r.t)) byForm.set(r.t, []); byForm.get(r.t).push(r); }
const out = { "H-type-valid": [], "H-type-invalid": [], "H-expr": [], other: [] };
for (const [t, list] of byForm) {
  const alias = ctxs.alias.replace("%T%", () => t);
  const a = { base: acc(base, alias), head: acc(head, alias), tsc: tscState(oracle.records.get(alias)) };
  for (const r of list) {
    if (r.ctx !== "heritage" && r.ctx !== "iextends") { out.other.push([r, a]); continue; }
    if (a.head && a.tsc.startsWith("valid")) out["H-type-valid"].push([r, a]);
    else if (a.head) out["H-type-invalid"].push([r, a]);
    else out["H-expr"].push([r, a]);
  }
}
for (const [k, list] of Object.entries(out)) {
  console.log(`== ${k}: ${list.length} sources`);
  if (k === "other") continue;
  const seen = new Set();
  for (const [r, a] of list) {
    if (seen.has(r.t)) continue; seen.add(r.t);
    const ctxsOf = list.filter(x => x[0].t === r.t).map(x => x[0].ctx).join(",");
    console.log(`   ${JSON.stringify(r.t)} [${ctxsOf}] ${r.cause.replace(/RESTORE: (tsc does not parse|grammar error of the checker) /, "")} | alias: base ${a.base ? "A" : "R"} head ${a.head ? "A" : "R"} tsc ${a.tsc}`);
  }
}
