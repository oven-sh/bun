// Probe: per unit, compares the imported tree with typescript-go's tree at three mask levels and writes a table.
// L0: byte for byte. L1: ranges of comment lists and of JSDocText and link nodes, and their text, masked.
// L2: also the JSDocText nodes themselves and the length of comment lists.
// usage: bun measure3.ts <filter regexp> <out.tsv>      env CORPUS, GOOUT
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, print, ruleHits } from "./convert.mjs";
import { stats as reparseStats } from "./reparse.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const GOOUT = process.env.GOOUT ?? "/tmp/tsimp/go-out";
const names = fs.readdirSync(CORPUS).sort();
const filter = new RegExp(process.argv[2] ?? ".");
const out = process.argv[3] ?? "/tmp/jsdocrp/measure3.tsv";
const HEADER = /^(diagnostic\.related|jsDiagnostic\.related|jsdocDiagnostic\.related|file |externalModuleIndicator|commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic )/;
const NODE = /^(\s*)(\S+) (Kind\w+) \[(-?\d+),(-?\d+)\) f=(0x[0-9a-f]+)(.*)$/;
function l1(lines: string[]) {
  return lines.map(l => {
    if (/^\s*\.Comment: list \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)");
    if (/Kind(JSDocText|JSDocLink|JSDocLinkCode|JSDocLinkPlain) \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)").replace(/ text=".*"$/, " text=_");
    return l;
  });
}
function l2(lines: string[]) {
  const o: string[] = [];
  for (const l of l1(lines)) {
    if (/^\s*- KindJSDocText \[/.test(l)) continue;
    if (/^\s*\.Comment: list \[/.test(l)) { o.push(l.replace(/ n=\d+$/, " n=_")); continue; }
    o.push(l);
  }
  return o;
}
function firstDiff(a: string[], b: string[]) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i === a.length && i === b.length ? -1 : i;
}
function classify(a?: string, b?: string) {
  if (a === undefined) return "ts-has-extra-lines";
  if (b === undefined) return "go-has-extra-lines";
  const ra = NODE.exec(a), rb = NODE.exec(b);
  if (!ra || !rb) { const la = /^\s*(\S+)/.exec(a)?.[1], lb = /^\s*(\S+)/.exec(b)?.[1]; return `shape go<${la}${ra ? " " + ra[3] : ""}> ts<${lb}${rb ? " " + rb[3] : ""}>`; }
  if (ra[1] !== rb[1] || ra[2] !== rb[2]) return `label go<${ra[2]} ${ra[3]}> ts<${rb[2]} ${rb[3]}>`;
  if (ra[3] !== rb[3]) return `kind go<${ra[3]}> ts<${rb[3]}>`;
  if (ra[4] !== rb[4] || ra[5] !== rb[5]) return `pos ${ra[3]}`;
  if (ra[6] !== rb[6]) { const x = (parseInt(ra[6]) ^ parseInt(rb[6])) >>> 0; return `flags ${ra[3]} xor=0x${x.toString(16)}`; }
  return `fields ${ra[3]}`;
}
const rows: string[] = ["unit\tgoJsdoc\tgoReparsed\ttsErr\tgoErr\tL0\tL1\tL2\tclassL2\ttsOnlyKinds"];
const TS_ONLY = /"(JSDocFunctionType|JSDocNamepathType|JSDocUnknownType|JSDocEnumTag|JSDocClassTag|JSDocAuthorTag|JSDocMemberName)"/g;
let n = 0;
const tot = { L0: 0, L1: 0, L2: 0 };
for (const vname of names) {
  if (!filter.test(vname)) continue;
  n++;
  const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
  const goAll = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n");
  const goErr = goAll.filter(l => l.startsWith("diagnostic ")).length;
  const goJsdoc = goAll.some(l => l.includes(".jsdoc:")) ? 1 : 0;
  const goReparsed = goAll.some(l => NODE.test(l) && (parseInt(NODE.exec(l)![6]) & 8) !== 0) ? 1 : 0;
  const go = goAll.filter(l => l.length && !HEADER.test(l));
  let lines: string[] = [], tsErr = 0, tsOnly = "";
  try {
    const bundle = dumpFiles([{ name: "/" + vname, text: raw }], { force: !!process.env.FORCE, jsx: !!process.env.JSX });
    tsErr = bundle.files[0].diagnostics.length;
    const used = new Set<string>();
    const kindIdx = new Map(bundle.kinds.map((k, i) => [i, k]));
    const f = bundle.files[0];
    for (let i = 0; i < f.nodes.length; i += 8) { const k = kindIdx.get(f.nodes[i])!; if (/^JSDoc(FunctionType|NamepathType|UnknownType|EnumTag|ClassTag|AuthorTag|MemberName)$/.test(k)) used.add(k); }
    tsOnly = [...used].sort().join(",");
    lines = print(importDump(JSON.parse(JSON.stringify(bundle))));
  } catch (e: any) {
    rows.push([vname, goJsdoc, goReparsed, -1, goErr, 0, 0, 0, "EXC " + String(e.message).slice(0, 80), ""].join("\t"));
    continue;
  }
  const d0 = firstDiff(go, lines), a1 = l1(go), b1 = l1(lines), d1 = firstDiff(a1, b1), a2 = l2(go), b2 = l2(lines), d2 = firstDiff(a2, b2);
  if (d0 < 0) tot.L0++;
  if (d1 < 0) tot.L1++;
  if (d2 < 0) tot.L2++;
  rows.push([vname, goJsdoc, goReparsed, tsErr, goErr, d0 < 0 ? 1 : 0, d1 < 0 ? 1 : 0, d2 < 0 ? 1 : 0, d2 < 0 ? "" : classify(a2[d2], b2[d2]), tsOnly].join("\t"));
}
fs.writeFileSync(out, rows.join("\n") + "\n");
fs.writeFileSync(out.replace(/\.tsv$/, ".rules.json"), JSON.stringify({ convert: [...ruleHits].sort((a: any, b: any) => b[1] - a[1]), reparse: [...reparseStats].sort((a: any, b: any) => b[1] - a[1]) }, null, 1));
console.log(`units ${n}: identical L0 ${tot.L0}, L1 ${tot.L1}, L2 ${tot.L2}`);
