// Probe: chooses JavaScript fixture units that together exercise every reparse branch, every kind of reparsed node,
// every JSDoc node kind and every JS-only diagnostic that the corpus has, among the units whose imported tree equals
// typescript-go's at mask level L2. Greedy cover, smallest unit first.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump } from "./convert.mjs";
import { stats } from "./reparse.mjs";
const CORPUS = "/tmp/tsimp/corpus", GOOUT = "/tmp/jsdocrp/go-js";
const rows = fs.readFileSync("/tmp/jsdocrp/m.js.tsv", "utf8").trim().split("\n").slice(1).map(l => l.split("\t"));
const manifest = new Map<string, any>(JSON.parse(fs.readFileSync("/tmp/tsimp/corpus.manifest.json", "utf8")).map((m: any) => [m.vname, m]));
const NODE = /^(\s*)(\S+) (Kind\w+) \[(-?\d+),(-?\d+)\) f=(0x[0-9a-f]+)(.*)$/;
const cands: { unit: string; bytes: number; feats: Set<string> }[] = [];
for (const r of rows) {
  const [unit, goJsdoc, goReparsed, tsErr, goErr, L0, L1, L2] = r;
  if (L2 !== "1") continue;
  const feats = new Set<string>();
  const raw = fs.readFileSync(path.join(CORPUS, unit), "utf8");
  stats.clear();
  importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + unit, text: raw }]))));
  for (const k of stats.keys()) feats.add("reparse:" + k);
  const go = fs.readFileSync(path.join(GOOUT, unit + ".tsgo.txt"), "utf8").split("\n");
  for (const l of go) {
    let m = /^jsDiagnostic \[\d+,\d+\) TS(\d+)/.exec(l);
    if (m) { feats.add("jsdiag:TS" + m[1]); continue; }
    m = /^jsdocDiagnostic \[\d+,\d+\) TS(\d+)/.exec(l);
    if (m) { feats.add("jsdocdiag:TS" + m[1]); continue; }
    const n = NODE.exec(l);
    if (!n) continue;
    const f = parseInt(n[6]);
    if (f & 8) feats.add("reparsed:" + n[3] + (n[2].startsWith(".") ? "@" + n[2].replace(":", "") : ""));
    if (f & (1 << 28)) feats.add("transformed-literal:" + n[3]);
    if (n[3].startsWith("KindJSDoc")) feats.add("jsdoc:" + n[3]);
    if (n[2] === ".FullSignature:") feats.add("label:FullSignature");
    if (/ parent=KindEndOfFile/.test(l)) feats.add("host:EndOfFile");
    if (n[3] === "KindJSTypeAliasDeclaration" || n[3] === "KindJSImportDeclaration" || (n[3] === "KindModuleDeclaration" && f & 8)) feats.add(`list-depth:${n[3]}@${n[1].length}`);
  }
  if (feats.size) cands.push({ unit, bytes: raw.length, feats });
}
const all = new Set<string>();
for (const c of cands) for (const f of c.feats) all.add(f);
const covered = new Set<string>();
const chosen: typeof cands = [];
while (covered.size < all.size) {
  let best: (typeof cands)[number] | undefined, bestGain = 0;
  for (const c of cands) {
    let gain = 0;
    for (const f of c.feats) if (!covered.has(f)) gain++;
    if (gain > bestGain || (gain === bestGain && gain > 0 && best && c.bytes < best.bytes)) { best = c; bestGain = gain; }
  }
  if (!best) break;
  chosen.push(best);
  for (const f of best.feats) covered.add(f);
}
chosen.sort((a, b) => (a.unit < b.unit ? -1 : 1));
const lines = ["virtual name\tcase\tunit\tbytes\tfeatures"];
for (const c of chosen) { const m = manifest.get(c.unit); lines.push([c.unit, m.case, m.unit, c.bytes, [...c.feats].sort().join(" ")].join("\t")); }
fs.writeFileSync("/tmp/jsdocrp/js-fixtures.tsv", lines.join("\n") + "\n");
fs.writeFileSync("/tmp/jsdocrp/js-fixture-features.txt", [...all].sort().join("\n") + "\n");
console.log(`candidates ${cands.length}, features ${all.size}, chosen ${chosen.length} units, ${chosen.reduce((a, c) => a + c.bytes, 0)} bytes`);
