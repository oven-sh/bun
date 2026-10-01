// Where one run of harness.mjs and tsc disagree on whether a source parses.
//
//   bun versus-tsc.mjs <run.jsonl.gz> <oracle.jsonl.gz> [--api=t.ts.plain] [--out=<file.jsonl>]
//
// Class A: tsc parses without a diagnostic, the run rejects.  Class B: the run accepts, tsc reports a diagnostic.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [runPath, oraclePath] = args.filter(a => !a.startsWith("--"));
const api = flag("api") ?? "t.ts.plain";
const lines = path => gunzipSync(readFileSync(path)).toString("utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const run = lines(runPath);
const header = run[0];
const at = header.apis.indexOf(api);
if (at < 0) throw new Error(`no api ${api} in ${runPath}`);
const dialect = api.includes(".tsx.") ? "tsx" : "ts";
const oracle = new Map(lines(oraclePath).slice(1).map(r => [r.src, r]));
const count = { AA: 0, RR: 0, A: 0, B: 0 };
const byProd = {};
const out = [];
for (const r of run.slice(1)) {
  if (r.crash !== undefined) continue;
  const o = oracle.get(r.src);
  if (!o) continue;
  const value = r.vals[r.res[at]];
  const bun = value[0] !== "e";
  const tsc = o[dialect].length === 0;
  const cls = bun && tsc ? "AA" : !bun && !tsc ? "RR" : tsc ? "A" : "B";
  count[cls]++;
  if (cls === "A" || cls === "B") {
    const key = `${cls} ${r.prod}${r.mut ? " (mutated)" : ""}`;
    byProd[key] = (byProd[key] ?? 0) + 1;
    out.push({ cls, src: r.src, prod: r.prod, ctx: r.ctx, t: r.t, mut: r.mut, bun: value[0] === "e" ? value[1] : null, tsc: o[dialect].map(d => [d[0], d[3]]) });
  }
}
console.log(`${runPath} ${header.revision} api ${api}: both accept ${count.AA}, both reject ${count.RR}, A (tsc parses, bun rejects) ${count.A}, B (bun accepts, tsc rejects) ${count.B}`);
for (const [key, n] of Object.entries(byProd).sort()) console.log(`  ${String(n).padStart(7)}  ${key}`);
if (flag("out")) writeFileSync(flag("out"), out.map(o => JSON.stringify(o)).join("\n") + "\n");
