// Chooses the binder fixtures from the usable units.
// 1. greedy cover of the statements of the reference's binder package (most new statements first, then the smaller unit, then the name):
//    first with single-file cases only, then with units of multi-file cases for what the single-file cases do not reach
// 2. one single-file case for each directory (one level below conformance) that has none yet: the middle one by name
// 3. a stride over the remaining single-file cases, one third compiler and two thirds conformance
// usage: bun select.mjs <units.tsv> <coverage.tsv.gz> <bad-units.txt> <excluded.txt> <out SELECTION.tsv> [singles=200] [max bytes=6000]
// coverage.tsv.gz: the statements of internal/binder that each unit makes the reference run (groundtruth/build.sh with COVER=1)
// bad-units.txt: units whose .symbols baseline prints, for a declaration name, a symbol that only the checker makes
// excluded.txt: units whose tree from TypeScript 6.0.2 differs from the tree of the reference's parser
import fs from "node:fs";
import zlib from "node:zlib";
const [unitsPath, coverPath, symcheckPath, excludedPath, outPath, totalArg, capArg] = process.argv.slice(2);
const SINGLES = Number(totalArg ?? 200);
const CAP = Number(capArg ?? 6000);
const GREEDY_CAP = CAP * 4;
const excluded = new Set(fs.existsSync(excludedPath) ? fs.readFileSync(excludedPath, "utf8").split("\n").filter(Boolean) : []);
const bad = new Set(fs.readFileSync(symcheckPath, "utf8").split("\n").filter(Boolean));
const cover = { blocks: {} };
const coverByName = new Map();
{
  const blockNames = [];
  let section = "";
  for (const l of zlib.gunzipSync(fs.readFileSync(coverPath)).toString("utf8").split("\n")) {
    if (l === "") continue;
    if (l.startsWith("# ")) { section = l.slice(2, l.indexOf(":")); continue; }
    const f = l.split("\t");
    if (section === "blocks") { blockNames[Number(f[0])] = f[1]; cover.blocks[f[1]] = Number(f[2]); continue; }
    const list = [];
    for (const r of f[1] === "" ? [] : f[1].split(",")) {
      const [a, b] = r.split("-").map(Number);
      for (let i = a; i <= (b ?? a); i++) list.push(blockNames[i]);
    }
    coverByName.set(f[0], list);
  }
}
const all = fs.readFileSync(unitsPath, "utf8").split("\n").filter(Boolean).map(l => {
  const [id, rel, suite, stem, index, unit, kind, lang, errors, oracle, bytes, virtual] = l.split("\t");
  return { id, rel, suite, stem, index, unit, kind, lang, errors, oracle, bytes: Number(bytes), virtual };
});
const usable = all.filter(c => !bad.has(c.virtual) && !excluded.has(c.id));
const weight = b => cover.blocks[b];
const reachable = new Set();
for (const c of all) for (const b of coverByName.get(c.virtual) ?? []) reachable.add(b);
const picked = new Map();
const covered = new Set();
let greedySingles = 0;
const less = (a, b) => a.bytes < b.bytes || (a.bytes === b.bytes && a.id < b.id);
for (const phase of ["single", "unit"]) for (;;) {
  let best = null, bestGain = 0;
  for (const c of usable) {
    if (picked.has(c.id) || c.bytes > GREEDY_CAP || c.kind !== phase) continue;
    let gain = 0;
    for (const b of coverByName.get(c.virtual) ?? []) if (!covered.has(b)) gain += weight(b);
    if (gain === 0) continue;
    if (gain > bestGain || (gain === bestGain && less(c, best))) { best = c; bestGain = gain; }
  }
  if (!best) break;
  picked.set(best.id, { ...best, reason: "cover+" + bestGain });
  if (phase === "single") greedySingles++;
  for (const b of coverByName.get(best.virtual)) covered.add(b);
}
const greedy = picked.size;
const singles = usable.filter(c => c.kind === "single" && c.bytes <= CAP && (c.lang === "ts" || c.lang === "dts" || c.lang === "tsx"));
const countSingles = () => [...picked.values()].filter(c => c.kind === "single").length;
const groupOf = c => (c.suite === "compiler" ? "compiler" : c.rel.split("/").slice(0, 2).join("/"));
const groups = new Map();
for (const c of singles) { const g = groupOf(c); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
let perDirectory = 0;
for (const [g, list] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  if (g === "compiler" || countSingles() >= SINGLES) continue;
  if ([...picked.values()].some(c => groupOf(c) === g)) continue;
  const c = list[Math.floor(list.length / 2)];
  picked.set(c.id, { ...c, reason: "directory" });
  perDirectory++;
}
const need = Math.max(0, SINGLES - countSingles());
const quota = { conformance: Math.round((need * 2) / 3) };
quota.compiler = need - quota.conformance;
let stride = 0;
for (const suite of ["compiler", "conformance"]) {
  const list = singles.filter(c => c.suite === suite && !picked.has(c.id));
  const k = quota[suite];
  for (let i = 0; i < k; i++) {
    const c = list[Math.floor(((i + 0.5) * list.length) / k)];
    if (!picked.has(c.id)) { picked.set(c.id, { ...c, reason: "stride" }); stride++; }
  }
}
const rows = [...picked.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
fs.writeFileSync(outPath, rows.map(c => [c.id, c.rel, c.suite, c.stem, c.index, c.unit, c.kind, c.lang, c.errors, c.oracle, c.bytes, c.reason, c.virtual].join("\t")).join("\n") + "\n");
const stmts = s => [...s].reduce((n, b) => n + weight(b), 0);
const finalCovered = new Set();
for (const c of rows) for (const b of coverByName.get(c.virtual) ?? []) finalCovered.add(b);
const count = f => rows.filter(f).length;
console.log(JSON.stringify({ units: all.length, usable: usable.length, greedy, greedySingles, perDirectory, stride, selected: rows.length,
  singles: count(c => c.kind === "single"), unitsOfMultiFileCases: count(c => c.kind === "unit"),
  ts: count(c => c.lang === "ts"), tsx: count(c => c.lang === "tsx"), dts: count(c => c.lang === "dts"), js: count(c => c.lang === "js" || c.lang === "jsx"),
  bytes: rows.reduce((n, c) => n + c.bytes, 0), statementsInPackage: Object.values(cover.blocks).reduce((a, b) => a + b, 0),
  reachableByCorpus: stmts(reachable), coveredBySelection: stmts(finalCovered),
  withErrors: count(c => c.errors === "E"), tsgoDiffers: count(c => c.oracle !== "same-as-typescript"), directories: new Set(rows.map(groupOf)).size }));
const missed = [...reachable].filter(b => !finalCovered.has(b));
console.log("reachable by the corpus but not by the selection:", missed.length, missed.join(" "));
