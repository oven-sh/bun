// Probe: the number and the sorted ranges of the reparsed clones list against typescript-go's count.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump } from "./convert.mjs";
const rows = fs.readFileSync("/tmp/jsdocrp/m.js.tsv", "utf8").trim().split("\n").slice(1).map(l => l.split("\t"));
let n = 0, same = 0; const bad: string[] = [];
for (const r of rows) {
  if (r[7] !== "1" || r[2] !== "1") continue;
  n++;
  const go = fs.readFileSync(path.join("/tmp/jsdocrp/go-js", r[0] + ".tsgo.txt"), "utf8");
  const g = Number(/reparsedClones=(\d+)/.exec(go)![1]);
  const root = importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + r[0], text: fs.readFileSync(path.join("/tmp/tsimp/corpus", r[0]), "utf8") }]))));
  if (root.reparsedClones.length === g) same++; else bad.push(`${r[0]} go ${g} port ${root.reparsedClones.length}`);
}
console.log(`units with reparsed nodes and identical trees ${n}, same number of reparsed clones ${same}`);
for (const b of bad.slice(0, 10)) console.log("  " + b);
