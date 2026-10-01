import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
export function load(path) {
  const lines = gunzipSync(readFileSync(path)).toString("utf8").split("\n").filter(Boolean);
  const header = JSON.parse(lines[0]);
  const records = new Map();
  for (let i = 1; i < lines.length; i++) { const r = JSON.parse(lines[i]); records.set(r.src, r); }
  return { header, records };
}
export const val = (run, r, api) => r.vals[r.res[run.header.apis.indexOf(api)]];
export const acc = (run, src, api = "t.ts.plain") => { const r = run.records.get(src); return r ? val(run, r, api)[0] !== "e" : null; };
export const msg = (run, src, api = "t.ts.plain") => { const r = run.records.get(src); if (!r) return null; const v = val(run, r, api); return v[0] === "e" ? v[1].map(m => m[0]).join(" | ") : "A"; };
export const tscState = (o, dialect = "ts") => !o ? "?" : o[dialect].length ? "parse:" + o[dialect].map(d => "TS" + d[0]).join(",") : (o.chk?.[dialect]?.length ? "grammar:" + o.chk[dialect].map(d => "TS" + d[0]).join(",") : "valid" + (o.oth?.[dialect] ? "(" + o.oth[dialect].join(",") + ")" : ""));
