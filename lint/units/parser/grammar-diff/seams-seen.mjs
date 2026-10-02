// Which groups of a seam corpus a pair of runs tells apart: the differing records of diff.mjs (--out) by `prod`.
//
//   bun seams-seen.mjs <corpus.seams.json> <diff.seams.jsonl> [--sources]
//
// One line per group: sources of the group, sources with a differing record, records by class, and the
// method and loader of the configurations that differ. --sources lists every differing source.
// Exit code 1 when a group has no differing record. That is only of use for a run against the round-1
// binary, which must differ in every group but the ones that hold sites that round 1 left as they were
// (`guard.` of seams-bu.mjs, `site.unchanged` of seams.mjs).
// It reads the corpus and never imports a seams file: one of them writes a file when it is loaded.
import { readFileSync } from "node:fs";

const [corpusPath, diffPath, flag] = process.argv.slice(2);
if (!corpusPath || !diffPath) {
  console.error("usage: bun seams-seen.mjs <corpus.seams.json> <diff.seams.jsonl> [--sources]");
  process.exit(2);
}
const groups = new Map();
for (const s of JSON.parse(readFileSync(corpusPath, "utf8")).sources) groups.set(s.prod, (groups.get(s.prod) ?? 0) + 1);
const records = readFileSync(diffPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line));
const apiCount = new Set(records.map(d => d.api)).size;
const isUnchanged = prod => prod.startsWith("guard.") || prod === "site.unchanged";
const text = o =>
  Object.entries(o)
    .sort()
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
let unseen = 0;
for (const [prod, count] of groups) {
  const mine = records.filter(d => d.prod === prod);
  const sources = new Map();
  const classes = {};
  const loaders = {};
  for (const d of mine) {
    if (!sources.has(d.src)) sources.set(d.src, []);
    sources.get(d.src).push([d.api, d.cls]);
    classes[d.cls] = (classes[d.cls] ?? 0) + 1;
    const key = d.api.split(".").slice(0, 2).join(".");
    loaders[key] = (loaders[key] ?? 0) + 1;
  }
  const seen = sources.size > 0;
  if (!seen && !isUnchanged(prod)) unseen++;
  console.log(`${seen ? "seen  " : isUnchanged(prod) ? "same  " : "UNSEEN"} ${prod.padEnd(36)} ${String(sources.size).padStart(3)} of ${String(count).padStart(3)} sources differ, ${String(mine.length).padStart(5)} records  ${text(classes)}  | ${text(loaders)}`);
  if (flag === "--sources") {
    for (const [src, apis] of sources) {
      const byClass = {};
      for (const [api, cls] of apis) (byClass[cls] ??= []).push(api);
      console.log(`         ${JSON.stringify(src)}`);
      for (const [cls, list] of Object.entries(byClass)) console.log(`             ${cls} ${list.length === apiCount ? "every configuration that differs anywhere" : list.join(" ")}`);
    }
  }
}
process.exit(unseen > 0 ? 1 : 0);
