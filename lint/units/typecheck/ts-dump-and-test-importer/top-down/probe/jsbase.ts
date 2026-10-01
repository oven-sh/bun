// Probe: for JavaScript units, is the tree without the reparsed nodes the tree that TypeScript gives?
import fs from "node:fs";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, print } from "./convert.mjs";
const names = fs.readdirSync("/tmp/tsimp/corpus").filter(n => /\.(js|jsx|mjs|cjs)$/.test(n)).sort();
const NODE = /^(\s*)(\S+) (Kind\w+) \[(-?\d+),(-?\d+)\) f=(0x[0-9a-f]+)(.*)$/;
function base(lines: string[], isGo: boolean) {
  const out: string[] = [];
  let skip = -1;
  for (const l of lines) {
    const ind = l.length - l.trimStart().length;
    if (skip >= 0) { if (ind > skip) continue; skip = -1; }
    const t = l.trimStart();
    if (t.startsWith(".jsdoc:")) { skip = ind; continue; }
    const m = NODE.exec(l);
    if (!m) continue;
    const flags = parseInt(m[6]);
    if (flags & 0x8) { skip = ind; continue; }
    out.push(`${m[3]} [${m[4]},${m[5]}) ${(flags & ~0x200000 & ~0x4000000).toString(16)}${m[7].replace(/ SHARED$/, "")}`);
  }
  return out.sort();
}
let same = 0, differ = 0, extraCast = 0;
const ex: string[] = [];
for (const vname of names) {
  const raw = fs.readFileSync("/tmp/tsimp/corpus/" + vname, "utf8");
  const go = base(fs.readFileSync("/tmp/tsimp/go-out/" + vname + ".tsgo.txt", "utf8").split("\n"), true);
  const t = base(print(importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + vname, text: raw }]))))), false);
  if (go.join("\n") === t.join("\n")) { same++; continue; }
  // typescript-go wraps an expression in a cast for @type and @satisfies: remove those and compare again
  const goNoCast = go.filter(l => !/^Kind(AsExpression|SatisfiesExpression) /.test(l));
  const tNoCast = t.filter(l => !/^Kind(AsExpression|SatisfiesExpression) /.test(l));
  if (goNoCast.join("\n") === tNoCast.join("\n")) { extraCast++; continue; }
  differ++;
  if (ex.length < 12) {
    const gs = new Set(go), tss = new Set(t);
    ex.push(vname + "\n   only go: " + go.filter(l => !tss.has(l)).slice(0, 3).join(" | ") + "\n   only ts: " + t.filter(l => !gs.has(l)).slice(0, 3).join(" | "));
  }
}
console.log(`js units ${names.length}: same set of nodes ${same}, same but for casts ${extraCast}, other ${differ}`);
console.log(ex.join("\n"));
