// usage: bun cmp.mjs <base.jsonl> <new.jsonl>   rows whose bun.ts result differs, by kind
import { readFileSync } from "node:fs";
const rd = f => readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l));
const a = rd(process.argv[2]), b = rd(process.argv[3]);
const kinds = {};
for (let i = 0; i < a.length; i++) {
  const x = a[i].ts, y = b[i].ts;
  if (x.bun === y.bun) continue;
  const was = x.bun.startsWith("OK"), is = y.bun.startsWith("OK");
  const tsc = x.cls;
  let kind;
  if (!was && is) kind = tsc === "REJ" ? "newly accepted, tsc rejects" : ("newly accepted, tsc " + tsc + (norm(y.bun) === norm("OK  " + x.js) ? " same reading" : " OTHER reading"));
  else if (was && !is) kind = "REJECTED NOW (was accepted)";
  else if (was && is) kind = "output changed (was accepted)";
  else kind = "error message changed";
  (kinds[kind] ??= []).push([a[i].src, x.bun, y.bun, x.js]);
}
function norm(s) { return s.replace(/^OK\s+/, "").replace(/"use strict";\s*/, "").replace(/[()\s;]/g, ""); }
for (const [k, rows] of Object.entries(kinds)) {
  console.log(`== ${k}: ${rows.length}`);
  if (process.env.SHOW?.split(",").some(s => k.includes(s)) || process.env.SHOW === "all") for (const r of rows) console.log("   ", JSON.stringify(r[0]).padEnd(56), "|", r[1].slice(0, 40).padEnd(40), "|", r[2].slice(0, 50).padEnd(50), "| tsc:", r[3] ?? "");
}
