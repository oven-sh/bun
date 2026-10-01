// Probe: route A end to end. TypeScript 6.0.2 dump -> convert -> reparse (JavaScript) -> print, compared with the dump of typescript-go's own tree.
// env: CORPUS, GOOUT, MASK=comments|tagcomments|none (default none), NOREPARSE=1, REPORT=<file>, TOP=<n>, LIST=<file with unit names>
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { inflate, convert, postprocess, ruleHits } from "./convert.mjs";
import { reparse, print, setParents, stats } from "./reparse.mjs";
import { fixJSDoc, fixHits } from "./jsdocfix.mjs";

const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const GOOUT = process.env.GOOUT ?? "/tmp/tsimp/go-out";
const MASK = process.env.MASK ?? "none";
const names = process.env.LIST ? fs.readFileSync(process.env.LIST, "utf8").split("\n").filter(Boolean) : fs.readdirSync(CORPUS).sort();
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const HEADER = /^(diagnostic\.related|file |externalModuleIndicator|commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic |jsDiagnostic\.related|jsdocDiagnostic\.related)/;
const NODE = /^(\s*)(\S+) (Kind\w+) \[(-?\d+),(-?\d+)\) f=(0x[0-9a-f]+)(.*)$/;

function maskTagComments(lines: string[]) {
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
  if (MASK === "tagcomments") return maskTagComments(lines);
  if (MASK !== "comments") return lines;
  return lines.map(l => {
    if (/^\s*\.Comment: list \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)");
    if (/Kind(JSDocText|JSDocLink|JSDocLinkCode|JSDocLinkPlain) \[/.test(l)) return l.replace(/\[-?\d+,-?\d+\)/, "[_,_)").replace(/ text=".*"$/, " text=_");
    return l;
  });
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

export function importRouteA(vname: string, raw: string) {
  const bundle = JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + vname, text: raw }], { force: !!process.env.FORCE, jsx: !!process.env.JSX })));
  const d = bundle.files[0];
  const isJS = d.scriptKind === 1 || d.scriptKind === 2;
  const ctx = { isJS, textBytes: Buffer.from(d.text, "utf8"), text: d.text };
  const root = convert(inflate(bundle, d), ctx);
  fixJSDoc(root, ctx);
  if (isJS && !process.env.NOREPARSE) reparse(root);
  else setParents(root);
  postprocess(root, d);
  return { root, d, isJS };
}

if (import.meta.main) {
  let same = 0, differ = 0, failed = 0, n = 0, differClean = 0, withErr = 0, jsdocUnits = 0, jsdocSame = 0, clonesDiffer = 0;
  const classes = new Map<string, string[]>();
  const differing: string[] = [];
  const sameList: string[] = [];
  for (const vname of names) {
    if (filter && !filter.test(vname)) continue;
    n++;
    const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
    let lines: string[], tsErr = 0, clones = -1;
    try {
      const { root, d } = importRouteA(vname, raw);
      tsErr = d.diagnostics.length;
      clones = root.reparsedClones ?? 0;
      lines = print(root);
    } catch (e: any) {
      failed++;
      const key = "EXC " + String(e.stack).split("\n").slice(0, 2).join(" | ").slice(0, 200);
      if (!classes.has(key)) classes.set(key, []);
      classes.get(key)!.push(vname);
      continue;
    }
    const goAll = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n");
    const goErr = goAll.filter(l => l.startsWith("diagnostic ")).length;
    const hasJsdoc = goAll.some(l => l.includes(".jsdoc:"));
    if (hasJsdoc) jsdocUnits++;
    const clean = tsErr === 0 && goErr === 0;
    if (!clean) withErr++;
    let go = goAll.filter(l => l.length && !HEADER.test(l));
    go = maskComments(go); lines = maskComments(lines);
    let i = 0;
    while (i < go.length && i < lines.length && go[i] === lines[i]) i++;
    if (i === go.length && i === lines.length) {
      same++; sameList.push(vname); if (hasJsdoc) jsdocSame++;
      const gc = Number(/reparsedClones=(\d+)/.exec(goAll.find(l => l.startsWith("counts ")) ?? "")?.[1] ?? -1);
      if (gc !== clones) clonesDiffer++;
      continue;
    }
    differ++;
    differing.push(vname);
    if (clean) differClean++;
    const key = (clean ? "CLEAN " : "err   ") + classify(go[i], lines[i]);
    if (!classes.has(key)) classes.set(key, []);
    classes.get(key)!.push(`${vname}:${i + 1}`);
  }
  const sorted = [...classes].sort((a, b) => b[1].length - a[1].length);
  console.log(`units ${n} same ${same} differ ${differ} (of them without parse errors ${differClean}) failed ${failed}; units with parse errors ${withErr}; units with JSDoc ${jsdocUnits}, of them same ${jsdocSame}; same but reparsedClones count differs ${clonesDiffer}`);
  for (const [k, v] of sorted.slice(0, Number(process.env.TOP ?? 40))) console.log(String(v.length).padStart(6), k, "  e.g.", v.slice(0, 3).join(" "));
  const rep = process.env.REPORT ?? "/tmp/jsr/out";
  fs.writeFileSync(rep + ".classes.json", JSON.stringify(sorted, null, 1));
  fs.writeFileSync(rep + ".differing.txt", differing.join("\n") + "\n");
  fs.writeFileSync(rep + ".same.txt", sameList.join("\n") + "\n");
  fs.writeFileSync(rep + ".rules.json", JSON.stringify({ convert: [...ruleHits].sort((a: any, b: any) => b[1] - a[1]), reparse: [...stats].sort((a: any, b: any) => b[1] - a[1]), jsdocfix: [...fixHits].sort((a: any, b: any) => b[1] - a[1]) }, null, 1));
}
