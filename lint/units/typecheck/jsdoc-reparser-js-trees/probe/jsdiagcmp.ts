// Probe: compares the TS8xxx diagnostics that the port of checkJSSyntax gives with typescript-go's JSDiagnostics, unit by unit.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump } from "./convert.mjs";
import { checkJS } from "./jscheck.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const GOOUT = process.env.GOOUT ?? "/tmp/tsimp/go-out";
const filter = new RegExp(process.argv[2] ?? "\\.(js|jsx|mjs|cjs)$");
const ORDERED = !process.env.UNORDERED;
let units = 0, withDiag = 0, same = 0, total = 0, sameSet = 0;
const classes = new Map<string, string[]>();
for (const vname of fs.readdirSync(CORPUS).sort()) {
  if (!filter.test(vname)) continue;
  units++;
  const goLines = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n");
  const go: string[] = [];
  for (const l of goLines) {
    let m = /^jsDiagnostic \[(-?\d+),(-?\d+)\) TS(\d+) /.exec(l);
    if (m) { go.push(`${m[1]},${m[2]},${m[3]}`); continue; }
    m = /^jsDiagnostic\.related \[(-?\d+),(-?\d+)\) TS(\d+) /.exec(l);
    if (m) go[go.length - 1] += `+${m[1]},${m[2]},${m[3]}`;
  }
  const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const root = importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + vname, text: raw }]))));
  const mine = checkJS(root, Buffer.from(text, "utf8")).map(d => `${d[0]},${d[1]},${d[2]}` + (d[3] ? `+${d[3][0]},${d[3][1]},${d[3][2]}` : ""));
  total += go.length;
  if (go.length || mine.length) withDiag++;
  const a = go.join(" "), b = mine.join(" ");
  const sa = [...go].sort().join(" "), sb = [...mine].sort().join(" ");
  if (sa === sb) sameSet++;
  if (a === b) { same++; continue; }
  const gs = new Set(go), ms = new Set(mine);
  const onlyGo = go.filter(x => !ms.has(x)), onlyMine = mine.filter(x => !gs.has(x));
  const key = sa === sb ? "order only" : `only go: ${[...new Set(onlyGo.map(x => "TS" + x.split(",")[2].split("+")[0]))].join(",") || "-"}; only port: ${[...new Set(onlyMine.map(x => "TS" + x.split(",")[2].split("+")[0]))].join(",") || "-"}`;
  if (!classes.has(key)) classes.set(key, []);
  classes.get(key)!.push(`${vname} go[${onlyGo.slice(0, 3).join(" ")}] port[${onlyMine.slice(0, 3).join(" ")}]`);
}
console.log(`units ${units}, with a JS diagnostic on a side ${withDiag}, identical lists ${same}, identical as sets ${sameSet}; diagnostics of typescript-go ${total}`);
for (const [k, v] of [...classes].sort((x, y) => y[1].length - x[1].length)) console.log(String(v.length).padStart(5), k, "\n        e.g.", v.slice(0, 3).join("\n             "));
