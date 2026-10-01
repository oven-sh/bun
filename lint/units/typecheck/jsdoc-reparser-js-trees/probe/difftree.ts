// Probe: compares the tree made from a dump with the dump of typescript-go's own tree, unit by unit.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, print, ruleHits } from "./convert.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const GOOUT = process.env.GOOUT ?? "/tmp/tsimp/go-out";
const names = fs.readdirSync(CORPUS).sort();
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const noJsdoc = !!process.env.NOJSDOC;
const MASK = !process.env.NOMASK;
const KEEP_EMI = !!process.env.EMI;
const HEADER = KEEP_EMI ? /^(diagnostic\.related|file |commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic )/ : /^(diagnostic\.related|file |externalModuleIndicator|commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic )/;
const NODE = /^(\s*)(\S+) (Kind\w+) \[(-?\d+),(-?\d+)\) f=(0x[0-9a-f]+)(.*)$/;
const MASKTAGS = !!process.env.MASKTAGS;
function maskTagComments(lines: string[]) {
  // masks only the comment lists of tags: those under a line of a tag node
  const out: string[] = [];
  const stack: { ind: number; tag: boolean }[] = [];
  for (const l of lines) {
    const ind = l.length - l.trimStart().length;
    while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
    const isTag = /Kind(JSDoc\w+Tag) \[/.test(l);
    const inTag = stack.some(s => s.tag);
    stack.push({ ind, tag: isTag });
    if (inTag && /^\s*\.Comment: list \[/.test(l)) { out.push(l.replace(/\[-?\d+,-?\d+\)/, "[_,_)")); continue; }
    if (inTag && /Kind(JSDocText|JSDocLink|JSDocLinkCode|JSDocLinkPlain) \[/.test(l)) { out.push(l.replace(/\[-?\d+,-?\d+\)/, "[_,_)").replace(/ text=".*"$/, " text=_")); continue; }
    out.push(l);
  }
  return out;
}
function maskComments(lines: string[]) {
  if (MASKTAGS) return maskTagComments(lines);
  if (!MASK) return lines;
  return lines.map(l => {
    if (/^\s*\.Comment: list \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)");
    if (/Kind(JSDocText|JSDocLink|JSDocLinkCode|JSDocLinkPlain) \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)").replace(/ text=".*"$/, " text=_");
    return l;
  });
}
function stripJsdoc(lines: string[]) {
  const out: string[] = [];
  let skip = -1;
  for (const l of lines) {
    const ind = l.length - l.trimStart().length;
    if (skip >= 0) { if (ind > skip) continue; skip = -1; }
    if (l.trimStart().startsWith(".jsdoc:")) { skip = ind; continue; }
    out.push(l);
  }
  return out;
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
let same = 0, differ = 0, failed = 0, n = 0, jsonBytes = 0, srcBytes = 0, differClean = 0, withErr = 0, jsdocUnits = 0;
const classes = new Map<string, string[]>();
const differing: string[] = [];
for (const vname of names) {
  if (filter && !filter.test(vname)) continue;
  n++;
  const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
  let lines: string[], tsErr = 0;
  try {
    const bundle = dumpFiles([{ name: "/" + vname, text: raw }], { force: !!process.env.FORCE, jsx: !!process.env.JSX });
    const json = JSON.stringify(bundle);
    jsonBytes += Buffer.byteLength(json); srcBytes += Buffer.byteLength(raw);
    tsErr = bundle.files[0].diagnostics.length;
    const root = importDump(JSON.parse(json));
    lines = print(root);
    if (KEEP_EMI) { const e = root.externalModuleIndicator; lines.unshift("externalModuleIndicator " + (e ? `Kind${e.kind}[${e.pos},${e.end})` : "<nil>")); }
  } catch (e: any) {
    failed++;
    const key = "EXC " + String(e.stack).split("\n").slice(0, 2).join(" | ").slice(0, 200);
    if (!classes.has(key)) classes.set(key, []);
    classes.get(key)!.push(vname);
    continue;
  }
  const goAll = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n");
  const goErr = goAll.filter(l => l.startsWith("diagnostic ")).length;
  if (goAll.some(l => l.includes(".jsdoc:"))) jsdocUnits++;
  const clean = tsErr === 0 && goErr === 0;
  if (!clean) withErr++;
  let go = goAll.filter(l => l.length && !HEADER.test(l));
  if (noJsdoc) { go = stripJsdoc(go); lines = stripJsdoc(lines); }
  go = maskComments(go); lines = maskComments(lines);
  let i = 0;
  while (i < go.length && i < lines.length && go[i] === lines[i]) i++;
  if (i === go.length && i === lines.length) { same++; continue; }
  differ++;
  differing.push(vname);
  if (clean) differClean++;
  const key = (clean ? "CLEAN " : "err   ") + classify(go[i], lines[i]);
  if (!classes.has(key)) classes.set(key, []);
  classes.get(key)!.push(`${vname}:${i + 1}`);
}
const sorted = [...classes].sort((a, b) => b[1].length - a[1].length);
console.log(`units ${n} same ${same} differ ${differ} (of them without parse errors ${differClean}) failed ${failed}; units with parse errors ${withErr}; units with JSDoc ${jsdocUnits}; src ${srcBytes} json ${jsonBytes}`);
for (const [k, v] of sorted.slice(0, Number(process.env.TOP ?? 40))) console.log(String(v.length).padStart(6), k, "  e.g.", v.slice(0, 3).join(" "));
fs.writeFileSync(process.env.REPORT ?? "/tmp/tsimp/final/diff-classes.json", JSON.stringify(sorted, null, 1));
fs.writeFileSync("/tmp/tsimp/final/rules-hit.json", JSON.stringify([...ruleHits].sort((a: any, b: any) => b[1] - a[1]), null, 1));
fs.writeFileSync("/tmp/tsimp/final/differing.txt", differing.join("\n") + "\n");
