// Probe: the JS-only diagnostics (TS8xxx and decorator placement) from the pass in checkjs.mjs against typescript-go's own, per JavaScript unit.
import fs from "node:fs";
import path from "node:path";
import { importRouteA } from "./difftree2.ts";
import { checkJS } from "./checkjs.mjs";
const CORPUS = "/tmp/tsimp/corpus", GOOUT = "/tmp/tsimp/go-out";
const sameTrees = new Set(fs.readFileSync(process.env.SAME ?? "/tmp/jsr/r5u.same.txt", "utf8").split("\n").filter(Boolean));
let units = 0, withDiag = 0, sameOrdered = 0, sameSorted = 0, differ = 0, goTotal = 0, mineTotal = 0, differOnSameTree = 0, unitsNone = 0;
const examples: string[] = [];
const byCode = new Map<string, number[]>();
for (const vname of fs.readdirSync(CORPUS).sort()) {
  if (!/\.(js|jsx|mjs|cjs)$/.test(vname)) continue;
  units++;
  const go = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n").filter(l => l.startsWith("jsDiagnostic "))
    .map(l => { const m = /^jsDiagnostic \[(\d+),(\d+)\) TS(\d+) cat=\d+ (.*)$/.exec(l)!; return `${m[1]},${m[2]},${m[3]}`; });
  const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
  const { root, d } = importRouteA(vname, raw);
  const mine = checkJS(root, Buffer.from(d.text, "utf8")).map(x => `${x[0]},${x[1]},${x[2]}`);
  goTotal += go.length; mineTotal += mine.length;
  for (const g of go) { const c = g.split(",")[2]; const v = byCode.get(c) ?? [0, 0]; v[0]++; byCode.set(c, v); }
  for (const g of mine) { const c = g.split(",")[2]; const v = byCode.get(c) ?? [0, 0]; v[1]++; byCode.set(c, v); }
  if (go.length === 0 && mine.length === 0) { unitsNone++; continue; }
  withDiag++;
  if (go.join("|") === mine.join("|")) { sameOrdered++; sameSorted++; continue; }
  if ([...go].sort().join("|") === [...mine].sort().join("|")) { sameSorted++; continue; }
  differ++;
  if (sameTrees.has(vname)) differOnSameTree++;
  if (examples.length < 10) examples.push(`${vname}${sameTrees.has(vname) ? "" : " (tree differs)"}\n     go:   ${go.filter(x => !mine.includes(x)).join(" ")}\n     mine: ${mine.filter(x => !go.includes(x)).join(" ")}`);
}
console.log(`JavaScript units ${units}; without JS diagnostics on both sides ${unitsNone}; with ${withDiag}: equal in order ${sameOrdered}, equal as a set ${sameSorted}, different ${differ} (of them on a tree that equals typescript-go's: ${differOnSameTree}); diagnostics typescript-go ${goTotal}, pass ${mineTotal}`);
console.log("by code (typescript-go, pass):", [...byCode].sort().map(([c, v]) => `TS${c} ${v[0]}/${v[1]}`).join(", "));
for (const e of examples) console.log("  ", e);
