// Probe: picks a small set of JavaScript units, among those whose route A tree equals typescript-go's, that exercises every
// branch counter of the reparser pass, every JSDoc conversion rule and every JS diagnostic code (greedy set cover).
import fs from "node:fs";
import { importRouteA } from "./difftree2.ts";
import { stats } from "./reparse.mjs";
import { fixHits } from "./jsdocfix.mjs";
import { ruleHits } from "./convert.mjs";
import { checkJS } from "./checkjs.mjs";
const same = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const man = new Map(JSON.parse(fs.readFileSync("/tmp/tsimp/corpus.manifest.json", "utf8")).map((m: any) => [m.vname, m]));
const features = new Map<string, Set<string>>();
const size = new Map<string, number>();
const tagKinds = (root: any, out: Set<string>) => {
  (function walk(g: any) {
    for (const j of g.jsdoc) (function w2(x: any) { if (/^JSDoc/.test(x.kind)) out.add("jsdoc-kind:" + x.kind); for (const c of x.children.values()) { if (c.list) for (const y of c.nodes) w2(y); else w2(c); } })(j);
    if (g.flags & 8 && !/^JSDoc/.test(g.kind)) out.add("reparsed-kind:" + g.kind);
    for (const c of g.children.values()) { if (c.list) for (const x of c.nodes) walk(x); else walk(c); }
  })(root);
};
for (const vname of same) {
  const raw = fs.readFileSync("/tmp/tsimp/corpus/" + vname, "utf8");
  if (raw.length > 40000) continue;
  stats.clear(); fixHits.clear(); ruleHits.clear();
  const { root, d } = importRouteA(vname, raw);
  const f = new Set<string>();
  for (const k of stats.keys()) f.add("reparse:" + k);
  for (const k of fixHits.keys()) f.add("jsdocfix:" + k);
  for (const k of ruleHits.keys()) f.add("convert:" + k);
  for (const x of checkJS(root, Buffer.from(d.text, "utf8"))) f.add("jsdiag:TS" + x[2]);
  tagKinds(root, f);
  if (f.size) { features.set(vname, f); size.set(vname, raw.length); }
}
const all = new Set<string>();
for (const f of features.values()) for (const k of f) all.add(k);
const chosen: string[] = [];
const covered = new Set<string>();
while (covered.size < all.size) {
  let best = "", bestGain = 0;
  for (const [v, f] of features) {
    let gain = 0;
    for (const k of f) if (!covered.has(k)) gain++;
    if (gain > bestGain || (gain === bestGain && gain > 0 && size.get(v)! < size.get(best)!)) { best = v; bestGain = gain; }
  }
  if (!bestGain) break;
  chosen.push(best);
  for (const k of features.get(best)!) covered.add(k);
}
console.log(`features ${all.size}, units chosen ${chosen.length}, source bytes ${chosen.reduce((a, v) => a + size.get(v)!, 0)}`);
const rows = chosen.map(v => { const m: any = man.get(v); return [v, m.case, m.unit, size.get(v), [...features.get(v)!].sort().join(" ")].join("\t"); });
fs.writeFileSync(process.argv[3], "corpus name\tcase\tunit\tbytes\tfeatures\n" + rows.join("\n") + "\n");
fs.writeFileSync(process.argv[3].replace(/\.tsv$/, ".features.txt"), [...all].sort().join("\n") + "\n");
