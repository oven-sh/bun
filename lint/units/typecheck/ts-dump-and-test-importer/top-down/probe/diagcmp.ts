// Probe: how the parse diagnostics of TypeScript 6.0.2 differ from typescript-go's, by code.
import fs from "node:fs";
import { dumpFiles } from "./dump-ast.ts";
const names = fs.readdirSync("/tmp/tsimp/corpus").filter(n => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(n)).sort();
const classes = new Map<string, string[]>();
let differ = 0, withDiag = 0;
for (const vname of names) {
  const go = fs.readFileSync("/tmp/tsimp/go-out/" + vname + ".tsgo.txt", "utf8").split("\n").filter(l => l.startsWith("diagnostic ")).map(l => { const m = /^diagnostic \[(\d+),(\d+)\) TS(\d+)/.exec(l)!; return `${m[3]}@${m[1]}-${m[2]}`; });
  const d = dumpFiles([{ name: "/" + vname, text: fs.readFileSync("/tmp/tsimp/corpus/" + vname, "utf8") }]).files[0];
  const t = d.diagnostics.map(x => `${x[2]}@${x[0]}-${x[0] + x[1]}`);
  if (go.length || t.length) withDiag++;
  if (go.join() === t.join()) continue;
  differ++;
  const gs = new Set(go), tss = new Set(t);
  const onlyGo = go.filter(x => !tss.has(x)).map(x => "TS" + x.split("@")[0]);
  const onlyTs = t.filter(x => !gs.has(x)).map(x => "TS" + x.split("@")[0]);
  const key = `only typescript-go: ${[...new Set(onlyGo)].join(",") || "-"}; only TypeScript: ${[...new Set(onlyTs)].join(",") || "-"}`;
  if (!classes.has(key)) classes.set(key, []);
  classes.get(key)!.push(vname);
}
console.log(`units ${names.length}, with parse diagnostics on a side ${withDiag}, lists differ ${differ}`);
for (const [k, v] of [...classes].sort((a, b) => b[1].length - a[1].length)) console.log(String(v.length).padStart(4), k, " e.g.", v.slice(0, 2).join(" "));
