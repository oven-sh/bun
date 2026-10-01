// Scratch: a predicted diff. Every (source, api) the base rejects and tsc parses is given to the cause list as an R>A record
// (next unknown), to measure what the predicates of the cause list claim.
//   bun sim.mjs <corpus> <causes.mjs> [--show=N] [--api=a,b] [--unexplained=N]
import { resolve } from "node:path";
import { M, loadJsonl, loadRun, valueOf } from "./lib.mjs";
const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [corpus, causesPath] = args.filter(a => !a.startsWith("--"));
const base = loadRun(`${M}/base.${corpus}.jsonl.gz`);
const oracle = new Map(loadJsonl(`/tmp/gdo/oracle2.${corpus}.jsonl.gz`).slice(1).map(r => [r.src, r]));
const mod = await import(resolve(causesPath));
const causes = mod.default;
const apis = flag("api") ? flag("api").split(",") : base.header.apis;
const show = Number(flag("show") ?? 2);
const table = new Map();
const unexplained = new Map();
let total = 0;
for (const [src, rec] of base.records) {
  const tsc = oracle.get(src) ?? null;
  for (const api of apis) {
    const bv = valueOf(base, rec, api);
    if (bv[0] !== "e") continue;
    const dialect = api.includes(".tsx.") ? "tsx" : "ts";
    if (tsc[dialect].length !== 0 && !flag("all")) continue;
    total++;
    const d = { src, ctx: rec.ctx, t: rec.t, prod: rec.prod, mut: rec.mut, api, cls: "R>A", base: bv, next: ["o", ""], tsc };
    let owner = "unexplained";
    let ownerCause = null;
    for (const cause of causes) { const m = cause.match(d); if (m) { owner = typeof m === "string" ? `${cause.id} ${m}` : cause.id; ownerCause = cause; break; } }
    if (!table.has(owner)) table.set(owner, { n: 0, srcs: new Set(), ex: [], cause: ownerCause });
    const e = table.get(owner);
    e.n++;
    e.srcs.add(src);
    if (e.ex.length < show) e.ex.push(d);
    if (owner === "unexplained") {
      const k = bv[1][0][0].replace(/"[^"]*"/g, '"…"') + " | " + rec.prod;
      if (!unexplained.has(k)) unexplained.set(k, { n: 0, ex: new Set() });
      const u = unexplained.get(k);
      u.n++;
      if (u.ex.size < 4) u.ex.add(rec.t ?? src);
    }
  }
}
console.log(`${corpus}: ${total} records (base rejects, tsc parses) over ${apis.length} apis`);
for (const [owner, e] of [...table].sort((a, b) => causes.indexOf(a[1].cause) - causes.indexOf(b[1].cause) || (a[0] < b[0] ? -1 : 1))) {
  const c = e.cause;
  console.log(`${c?.forbidden || owner === "unexplained" ? "!!" : c?.ruling ? "??" : "  "} ${String(e.n).padStart(7)} records ${String(e.srcs.size).padStart(6)} sources  ${owner}`);
  for (const d of e.ex) console.log(`             ${d.api.padEnd(12)} ${JSON.stringify(d.src).slice(0, 90)}   base: ${d.base[1][0][0]}`);
}
if (unexplained.size) {
  console.log("unexplained, by base message and production:");
  for (const [k, u] of [...unexplained].sort((a, b) => b[1].n - a[1].n).slice(0, Number(flag("unexplained") ?? 60))) console.log(`   ${String(u.n).padStart(6)} ${k}   ${[...u.ex].map(s => JSON.stringify(s).slice(0, 50)).join("  ")}`);
}
