// Probe: do TypeScript 6.0.2 and typescript-go attach JSDoc to the same hosts? Compares (host kind, host range, JSDoc range) per unit.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, print } from "./convert.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const GOOUT = process.env.GOOUT ?? "/tmp/tsimp/go-out";
const filter = new RegExp(process.argv[2] ?? ".");
const NODE = /^(\s*)(\S+) (Kind\w+) \[(-?\d+),(-?\d+)\) f=(0x[0-9a-f]+)(.*)$/;
function hosts(lines: string[]) {
  const out = new Set<string>();
  const stack: { ind: number; key: string; flags: number }[] = [];
  for (const l of lines) {
    const m = NODE.exec(l);
    if (!m) continue;
    const ind = m[1].length;
    while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
    if (m[2] === ".jsdoc:") {
      const h = stack[stack.length - 1];
      // a reparsed host (type alias, parameter, property) shares or owns a synthetic JSDoc: not a question of attachment
      if (h && !(h.flags & 8) && !(parseInt(m[6]) & 8)) out.add(`${h.key} <- JSDoc[${m[4]},${m[5]})`);
    }
    stack.push({ ind, key: `${m[3]}[${m[4]},${m[5]})`, flags: parseInt(m[6]) });
  }
  return out;
}
let units = 0, same = 0, hostsGo = 0, hostsBoth = 0, onlyGo = 0, onlyTs = 0;
const ex: string[] = [];
const kindsOnlyGo = new Map<string, number>(), kindsOnlyTs = new Map<string, number>();
for (const vname of fs.readdirSync(CORPUS).sort()) {
  if (!filter.test(vname)) continue;
  const go = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n");
  if (!go.some(l => l.includes(".jsdoc:"))) continue;
  units++;
  const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
  const ts = print(importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + vname, text: raw }]))), 0, { noReparse: true }));
  const a = hosts(go), b = hosts(ts);
  let ok = true;
  for (const k of a) { hostsGo++; if (b.has(k)) hostsBoth++; else { onlyGo++; ok = false; const kk = k.split("[")[0]; kindsOnlyGo.set(kk, (kindsOnlyGo.get(kk) ?? 0) + 1); if (ex.length < 12) ex.push(`${vname}: only go ${k}`); } }
  for (const k of b) if (!a.has(k)) { onlyTs++; ok = false; const kk = k.split("[")[0]; kindsOnlyTs.set(kk, (kindsOnlyTs.get(kk) ?? 0) + 1); if (ex.length < 12) ex.push(`${vname}: only ts ${k}`); }
  if (ok) same++;
}
console.log(`units with JSDoc ${units}, same host set ${same}; attachments in go ${hostsGo}, in both ${hostsBoth}, only go ${onlyGo}, only ts ${onlyTs}`);
console.log("only go by kind", [...kindsOnlyGo]);
console.log("only ts by kind", [...kindsOnlyTs]);
for (const e of ex) console.log("  " + e);
