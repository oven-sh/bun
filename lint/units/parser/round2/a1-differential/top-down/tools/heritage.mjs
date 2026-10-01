// usage: node heritage.mjs <diff.jsonl> <head.jsonl.gz>
// For every RESTORE record in a heritage context: what the same type form is in the alias context.
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { gunzipSync } from "node:zlib";
const [path, headPath] = process.argv.slice(2);
const aliasCause = new Map(); // t -> cause in alias ctx, api t.ts.plain
const herit = new Map(); // t -> {ctxs, cause}
const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const d = JSON.parse(line);
  if (d.t == null || d.api !== "t.ts.plain") continue;
  if (d.ctx === "alias") aliasCause.set(d.t, `${d.cls} ${d.cause}`);
  if ((d.ctx === "heritage" || d.ctx === "iextends") && /^RESTORE/.test(d.cause)) {
    if (!herit.has(d.t)) herit.set(d.t, { ctxs: new Set(), cause: d.cause });
    herit.get(d.t).ctxs.add(d.ctx);
  }
}
// head values in alias context for forms without a diff record
const headAlias = new Map();
const lines = gunzipSync(readFileSync(headPath)).toString("utf8").split("\n");
const header = JSON.parse(lines[0]);
const at = header.apis.indexOf("t.ts.plain");
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const r = JSON.parse(lines[i]);
  if (r.ctx !== "alias" || !herit.has(r.t)) continue;
  const v = r.vals[r.res[at]];
  headAlias.set(r.t, v[0] === "e" ? "R(" + v[1][0][0] + ")" : "A");
}
const groups = new Map();
for (const [t, h] of herit) {
  const a = aliasCause.get(t) ?? `same on both sides: ${headAlias.get(t) ?? "?"}`;
  const g = /^R>A RESTORE/.test(a) ? "1 the form itself is restored" : /^R>A/.test(a) ? "3 LEAK: the form is a valid new type form elsewhere" : /^same on both sides: A/.test(a) ? "2 base and head accept the type elsewhere: heritage-only reading" : "4 other: " + a.slice(0, 60);
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(`${JSON.stringify(t)} [${[...h.ctxs].join(",")}] ${h.cause.replace("RESTORE: ", "")}  || alias: ${a}`);
}
for (const [g, list] of [...groups].sort()) {
  console.log(`\n## ${g} (${list.length} forms)`);
  for (const l of list) console.log("  " + l);
}
