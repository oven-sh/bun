// Shared readers of the corpus pipeline.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export function readLines(path) {
  const raw = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  return text.split("\n").filter(Boolean);
}

export function readJsonl(path) {
  return readLines(path).map(l => JSON.parse(l));
}

// bun-side.mjs output: Map id -> { <config>: value } and the header.
export function readBunSide(path) {
  const lines = readLines(path);
  const header = JSON.parse(lines[0]);
  const out = new Map();
  for (let i = 1; i < lines.length; i++) {
    const r = JSON.parse(lines[i]);
    if (r.crash !== undefined) {
      out.set(r.id, { crash: r.crash });
      continue;
    }
    const o = {};
    header.configs.forEach((name, k) => (o[name] = r.v[r.r[k]]));
    out.set(r.id, o);
  }
  return { header, out };
}

// tsc-side.mjs and tsgo-side.mjs output: Map id -> { ts, tsx, dts? } with "=" resolved.
export function readParseSide(path) {
  const lines = readLines(path);
  const header = JSON.parse(lines[0]);
  const out = new Map();
  for (let i = 1; i < lines.length; i++) {
    const r = JSON.parse(lines[i]);
    const o = { ts: r.ts, tsx: r.tsx === "=" ? r.ts : r.tsx };
    if (r.dts !== undefined) o.dts = r.dts === "=" ? r.ts : r.dts;
    out.set(r.id, o);
  }
  return { header, out };
}

// The two class definitions that the earlier probes used for "tsc parses, Bun rejects".
export const isGrammarCode = code =>
  code < 2000 || (code >= 8000 && code < 9000) || (code >= 17000 && code < 18000) || (code >= 18000 && code < 19000);

export const tsv = s => JSON.stringify(s ?? "");
