import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
export const G = "/workspace/notes/lint/units/parser/grammar-diff";
export const M = "/workspace/notes/lint/units/parser/measure/base/grammar-diff";
export const D1 = new Set(JSON.parse(readFileSync("/tmp/gdo/grammar-codes.json", "utf8")).codes);
export const E1 = new Set(JSON.parse(readFileSync("/tmp/gdo/checker-grammar-codes.json", "utf8")).new.concat([17019, 17020]));
export function loadJsonl(path) {
  const raw = readFileSync(path);
  const lines = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8").split("\n").filter(Boolean);
  return lines.map(l => JSON.parse(l));
}
export function loadRun(path) {
  const all = loadJsonl(path);
  const header = all[0];
  const records = new Map();
  for (const r of all.slice(1)) records.set(r.src, r);
  return { header, records };
}
export const valueOf = (run, record, api) => {
  if (record === undefined) return ["missing"];
  if (record.crash !== undefined) return ["crash", record.crash];
  const at = run.header.apis.indexOf(api);
  return at < 0 ? ["missing"] : record.vals[record.res[at]];
};
export const dialectOf = api => (api.includes(".tsx.") || api.endsWith(".tsx") ? "tsx" : "ts");
export const legacyOf = api => /\.(exp|deco)\b/.test(api);
// The D1 filter: a private name for 2304, and 2300 dropped.
export const isD1 = d => D1.has(d[0]) && (d[0] !== 2304 || /^Cannot find name '#/.test(d[3] ?? "")) && d[0] !== 2300;
export function chkOf(chk, src, api) {
  const c = chk.get(src);
  if (!c) return null;
  const key = dialectOf(api) + (legacyOf(api) && src.includes("@") ? "L" : "");
  return c.c[key] ?? null;
}
