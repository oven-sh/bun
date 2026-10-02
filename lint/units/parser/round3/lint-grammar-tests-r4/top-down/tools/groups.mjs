// For each describe group of the four files: rows, classes, families, what tsc says, and the tables of the Rust test that hold its rows.
import { readFileSync } from "node:fs";
import { familyOf } from "/tmp/r4td/bu/gen/families.mjs";
const rows = JSON.parse(readFileSync("/tmp/r4td/bu/rows.facts2.json", "utf8"));
const SHORT = { "typescript-grammar.test.ts": "tg", "typescript-grammar-expressions.test.ts": "tg-expr", "typescript-grammar-statements.test.ts": "tg-stmt", "typescript-grammar-decorator-metadata.test.ts": "tg-meta" };
const groups = new Map();
for (const r of rows) {
  const key = `${SHORT[r.file]} | ${r.describe} | ${r.group}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
let n = 0;
for (const [key, list] of groups) {
  n++;
  const count = f => { const m = new Map(); for (const r of list) { const k = f(r); m.set(k, (m.get(k) ?? 0) + 1); } return [...m].map(([k, v]) => `${k} ${v}`).join(", "); };
  const entries = { type: 0, return: 0, "type-parameters": 0, heritage: 0 };
  for (const r of list) for (const x of r.roots) entries[x.entry]++;
  const mainR = list.filter(r => r.main[0] === "e").length;
  const want = count(r => (r.reject ? "Fails" : "Reads"));
  console.log(`G${String(n).padStart(2, "0")} ${list.length} rows [${list[0].i}..${list[list.length - 1].i}] ${key}`);
  console.log(`     loaders: ${count(r => r.loader)}; classes: ${count(r => r.class)}; main rejects ${mainR}; want: ${want}`);
  console.log(`     families: ${count(r => familyOf(r))}`);
  console.log(`     roots: type ${entries.type}, return ${entries.return}, type-parameters ${entries["type-parameters"]}, heritage ${entries.heritage}`);
}
