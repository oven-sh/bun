// Probe: compares only the JSDoc subtrees of JavaScript units, to judge the JSDoc conversion apart from reparsing.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, print } from "./convert.mjs";
const manifest = JSON.parse(fs.readFileSync("/tmp/tsimp/corpus.manifest.json", "utf8"));
const filter = new RegExp(process.argv[2] ?? "\\.(js|jsx|mjs|cjs)$");
function mask(l) {
  if (/^\s*\.Comment: list \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)");
  if (/Kind(JSDocText|JSDocLink|JSDocLinkCode|JSDocLinkPlain) \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)").replace(/ text=".*"$/, " text=_");
  return l;
}
function jsdocTrees(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trimStart();
    if (!t.startsWith(".jsdoc:")) continue;
    const ind = l.length - t.length;
    if (/ SHARED$/.test(l)) continue;
    const m = / f=(0x[0-9a-f]+)/.exec(l);
    if (m && parseInt(m[1]) & 0x8) continue; // reparsed JSDoc made for a parameter or property
    const tree = [mask(t)];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const lj = lines[j];
      const indj = lj.length - lj.trimStart().length;
      if (indj <= ind) break;
      tree.push(mask(lj.slice(ind)));
    }
    out.push(tree);
  }
  return out;
}
let units = 0, same = 0, trees = 0, treesSame = 0;
const classes = new Map();
for (const m of manifest) {
  if (!filter.test(m.vname)) continue;
  const go = fs.readFileSync(path.join("/tmp/tsimp/go-out", m.vname + ".tsgo.txt"), "utf8").split("\n");
  const g = jsdocTrees(go);
  if (g.length === 0) continue;
  units++;
  const raw = fs.readFileSync(path.join("/tmp/tsimp/corpus", m.vname), "utf8");
  const t = jsdocTrees(print(importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + m.vname, text: raw }]))))));
  // order by position of the JSDoc node, since reparsing moves hosts
  const key = tr => Number(/\[(\d+),/.exec(tr[0])?.[1] ?? -1);
  const gm = new Map(), tm = new Map();
  for (const tr of g) if (!gm.has(tr[0])) gm.set(tr[0], tr);
  for (const tr of t) if (!tm.has(tr[0])) tm.set(tr[0], tr);
  let ok = true;
  for (const [k, tr] of gm) {
    trees++;
    const o = tm.get(k);
    if (o && o.join("\n") === tr.join("\n")) { treesSame++; continue; }
    ok = false;
    let cls;
    if (!o) cls = "jsdoc node missing or at another range";
    else { let i = 0; while (i < tr.length && i < o.length && tr[i] === o[i]) i++; cls = `go<${(tr[i] ?? "<end>").trim().replace(/\[\S+\)/g, "[..)").replace(/Text="[^"]*"/, "Text=..").slice(0, 70)}> ts<${(o[i] ?? "<end>").trim().replace(/\[\S+\)/g, "[..)").replace(/Text="[^"]*"/, "Text=..").slice(0, 70)}>`; }
    if (!classes.has(cls)) classes.set(cls, []);
    classes.get(cls).push(m.vname + "@" + key(tr));
  }
  if (ok) same++;
}
console.log(`units with JSDoc ${units}, all JSDoc trees equal in ${same}; JSDoc trees ${trees}, equal ${treesSame}`);
for (const [k, v] of [...classes].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) console.log(String(v.length).padStart(5), k, " e.g.", v.slice(0, 2).join(" "));
