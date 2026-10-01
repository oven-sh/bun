import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
// path.go:674: every rune but U+0130 goes through the simple lower case mapping
export function toFileNameLowerCase(fileName: string): string {
  let out = "";
  for (const ch of fileName) {
    if (ch === "\u0130") { out += ch; continue; }
    const l = ch.toLowerCase();
    out += [...l].length === 1 ? l : ch;
  }
  return out;
}
const text = gunzipSync(readFileSync(import.meta.dir + "/../vectors/paths.jsonl.gz")).toString("utf8");
let bad = 0, rows = 0;
for (const l of text.split("\n")) {
  if (!l) continue;
  rows++;
  const r = JSON.parse(l);
  const got = toFileNameLowerCase(r.name);
  if (got !== r.toFileNameLowerCase) { bad++; if (bad < 10) console.log(JSON.stringify(r.name), JSON.stringify(got), JSON.stringify(r.toFileNameLowerCase)); }
}
console.log({ rows, bad });
