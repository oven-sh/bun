import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/workspace/bun/node_modules/");
const ts = require("typescript");
const ast = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_scripts/ast.json", "utf8"));
const goKinds = [];
for (const e of ast.kinds.elements) {
  if (typeof e === "string") goKinds.push(e);
  else if (e.name) goKinds.push(e.name);
}
console.log("ts version", ts.version);
console.log("go kinds", goKinds.length);
// TS kinds: unique names by value; enum has alias markers. Use the first name for each value in declaration order.
const tsNames = [];
const seen = new Map();
for (const k of Object.keys(ts.SyntaxKind)) {
  if (/^\d+$/.test(k)) continue;
  const v = ts.SyntaxKind[k];
  if (!seen.has(v)) { seen.set(v, k); }
}
// ts.SyntaxKind[v] reverse mapping gives the LAST name assigned (markers), so build own table
const tsByName = new Map();
for (const k of Object.keys(ts.SyntaxKind)) { if (!/^\d+$/.test(k)) tsByName.set(k, ts.SyntaxKind[k]); }
const markers = new Set(ast.kinds.markers.map(m => m.name));
const tsPrimary = [...seen.entries()].sort((a,b)=>a[0]-b[0]);
console.log("ts distinct values", tsPrimary.length, "Count=", ts.SyntaxKind.Count);
const goIndex = new Map(goKinds.map((n,i)=>[n,i]));
let same = 0;
const onlyTs = [], onlyGo = [];
for (const [v, n] of tsPrimary) {
  if (n === "Count") continue;
  if (!goIndex.has(n)) onlyTs.push(`${n}=${v}`);
  else if (goIndex.get(n) === v) same++;
}
const tsPrimaryNames = new Set(tsPrimary.map(x=>x[1]));
for (const n of goKinds) if (!tsPrimaryNames.has(n)) onlyGo.push(`${n}=${goIndex.get(n)}` + (tsByName.has(n) ? ` (ts has alias name =${tsByName.get(n)} primary=${seen.get(tsByName.get(n))})` : ""));
console.log("same number:", same);
console.log("only in TS (", onlyTs.length, "):", onlyTs.join(", "));
console.log("only in Go (", onlyGo.length, "):", onlyGo.join(", "));
console.log("go markers:", JSON.stringify(ast.kinds.markers));
