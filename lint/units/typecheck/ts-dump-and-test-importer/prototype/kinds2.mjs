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
const goSet = new Set(goKinds);
const goMarkers = new Set(ast.kinds.markers.map(m => m.name));
const allTsNames = Object.keys(ts.SyntaxKind).filter(k => !/^\d+$/.test(k));
console.log("all TS names:", allTsNames.length);
const notInGo = allTsNames.filter(n => !goSet.has(n) && !goMarkers.has(n));
console.log("TS names not in Go kinds nor Go markers (", notInGo.length, "):");
for (const n of notInGo) console.log("  ", n, "=", ts.SyntaxKind[n]);
const tsSet = new Set(allTsNames);
console.log("Go kinds not among TS names:", goKinds.filter(n => !tsSet.has(n)).map(n => `${n}=${goKinds.indexOf(n)}`).join(", "));
console.log("Go markers not among TS names:", [...goMarkers].filter(n => !tsSet.has(n)).join(", "));
// print ranges of TS vs Go numbering in blocks
let out = [];
for (let i = 0; i < Math.max(goKinds.length, 360); i++) {
  const tsName = allTsNames.find(n => ts.SyntaxKind[n] === i);
  out.push(`${i}\t${tsName ?? "-"}\t${goKinds[i] ?? "-"}${tsName === goKinds[i] ? "" : "\t*"}`);
}
fs.writeFileSync("/tmp/tsdump/kinds-table.txt", out.join("\n"));
