// Probe: does TypeScript 6.0.2 attach JSDoc comments to the same hosts as typescript-go? Compares (host kind, host range, JSDoc range).
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { inflate, convert } from "./convert.mjs";
import { fixJSDoc } from "./jsdocfix.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const GOOUT = process.env.GOOUT ?? "/tmp/tsimp/go-out";
const filter = new RegExp(process.argv[2] ?? ".");
const NODE = /^(\s*)(\S+) (Kind\w+) \[(-?\d+),(-?\d+)\) f=(0x[0-9a-f]+)(.*)$/;
let units = 0, unitsWith = 0, unitsSame = 0, pairsGo = 0, pairsTs = 0, onlyGo = 0, onlyTs = 0;
const byKindGo = new Map<string, number>(), byKindTs = new Map<string, number>(), hostKinds = new Map<string, number>();
const examples: string[] = [];
for (const vname of fs.readdirSync(CORPUS).sort()) {
  if (!filter.test(vname)) continue;
  units++;
  const go = new Set<string>();
  const stack: { ind: number; key: string }[] = [];
  for (const l of fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n")) {
    const m = NODE.exec(l);
    if (!m) continue;
    const ind = m[1].length;
    while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
    const key = `${m[3]}[${m[4]},${m[5]})`;
    if (m[2] === ".jsdoc:" && !(parseInt(m[6]) & 8)) {
      const note = / parent=(Kind\w+\[-?\d+,-?\d+\))/.exec(m[7]);
      const host = note ? note[1] : stack[stack.length - 1]?.key;
      go.add(`${host} <- [${m[4]},${m[5]})`);
    }
    stack.push({ ind, key });
  }
  const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
  const bundle = JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + vname, text: raw }])));
  const d = bundle.files[0];
  const isJS = d.scriptKind === 1 || d.scriptKind === 2;
  const ctx = { isJS, textBytes: Buffer.from(d.text, "utf8") };
  const root = convert(inflate(bundle, d), ctx);
  fixJSDoc(root, ctx);
  const ts = new Set<string>();
  (function walk(g: any) {
    for (const j of g.jsdoc) ts.add(`Kind${g.kind}[${g.pos},${g.end}) <- [${j.pos},${j.end})`);
    for (const c of g.children.values()) { if (c.list) for (const x of c.nodes) walk(x); else walk(c); }
  })(root);
  if (go.size === 0 && ts.size === 0) continue;
  unitsWith++;
  pairsGo += go.size; pairsTs += ts.size;
  let same = true;
  for (const k of go) { const hk = k.split("[")[0]; hostKinds.set(hk, (hostKinds.get(hk) ?? 0) + 1); if (!ts.has(k)) { same = false; onlyGo++; byKindGo.set(hk, (byKindGo.get(hk) ?? 0) + 1); if (examples.length < 12) examples.push(`${vname} only go: ${k}`); } }
  for (const k of ts) if (!go.has(k)) { same = false; onlyTs++; const hk = k.split("[")[0]; byKindTs.set(hk, (byKindTs.get(hk) ?? 0) + 1); if (examples.length < 12) examples.push(`${vname} only ts: ${k}`); }
  if (same) unitsSame++;
}
console.log(`units ${units}, with a JSDoc attachment ${unitsWith}, all attachments equal in ${unitsSame}; attachments typescript-go ${pairsGo}, TypeScript ${pairsTs}, only typescript-go ${onlyGo}, only TypeScript ${onlyTs}`);
console.log("only typescript-go, by host kind:", JSON.stringify([...byKindGo]));
console.log("only TypeScript, by host kind:", JSON.stringify([...byKindTs]));
console.log("host kinds in typescript-go:", [...hostKinds].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.replace("Kind", "")} ${v}`).join(", "));
for (const e of examples) console.log("  ", e);
