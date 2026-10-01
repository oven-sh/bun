// Scratch: where the metadata of the base differs from tsc (loose), per corpus: the A>A records to expect when the head equals tsc.
import { M, loadJsonl, loadRun, valueOf } from "./lib.mjs";
import { tagOf, metadataCalls, causeOf } from "/workspace/notes/lint/units/parser/probes/metadata.mjs";
const corpus = process.argv[2] ?? "targeted";
const api = process.argv[3] ?? "t.ts.deco";
const base = loadRun(`${M}/base.${corpus}.jsonl.gz`);
const oracle = new Map(loadJsonl(`/tmp/gdo/oracle2.${corpus}.jsonl.gz`).slice(1).map(r => [r.src, r]));
const byKey = list => { const m = {}; for (const [k, v] of list) (m[k] ??= []).push(tagOf(v)); return m; };
const count = { sources: 0, noTscMeta: 0, same: 0, differ: 0, callCount: 0, unparsed: 0 };
const causes = new Map();
const ctxs = new Map();
for (const [src, rec] of base.records) {
  if (!src.includes("@")) continue;
  const v = valueOf(base, rec, api);
  if (v[0] !== "o") continue;
  count.sources++;
  const o = oracle.get(src);
  const tsc = o.metaLoose ?? o.meta;
  if (!tsc) { count.noTscMeta++; continue; }
  const b = byKey(metadataCalls(v[1]));
  const t = byKey(tsc);
  const keys = new Set([...Object.keys(b), ...Object.keys(t)]);
  let differ = false, cc = false;
  for (const k of keys) {
    const x = b[k] ?? [], y = t[k] ?? [];
    if (x.length !== y.length) { cc = true; continue; }
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) differ = true;
  }
  if (JSON.stringify(b).includes("?(") || JSON.stringify(t).includes("?(")) count.unparsed++;
  if (cc) { count.callCount++; if ((ctxs.get("callcount " + rec.ctx) ?? 0) < 1) console.log("  call count differs:", JSON.stringify(src).slice(0, 100), JSON.stringify(b), JSON.stringify(t)); ctxs.set("callcount " + rec.ctx, 1); }
  else if (differ) {
    count.differ++;
    const cause = causeOf({ form: rec.t ?? "", ctx: rec.ctx ?? "src" }, b, t);
    if (!causes.has(cause)) causes.set(cause, { n: 0, ex: [] });
    const c = causes.get(cause);
    c.n++;
    if (c.ex.length < 3) c.ex.push([rec.t ?? src, JSON.stringify(b), JSON.stringify(t)]);
  } else count.same++;
}
console.log(corpus, api, count);
for (const [cause, c] of [...causes].sort((a, b) => b[1].n - a[1].n)) {
  console.log(String(c.n).padStart(6), cause);
  for (const e of c.ex) console.log("        ", JSON.stringify(e[0]).slice(0, 70), "base", e[1].slice(0, 80), "tsc", e[2].slice(0, 80));
}
