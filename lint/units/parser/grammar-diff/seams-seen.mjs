// Which groups of seams.mjs a pair of runs tells apart: the differing records of diff.mjs (--out) by `prod`.
//
//   bun seams-seen.mjs <diff.seams.jsonl> [--sources]      --sources lists every differing source with its configurations
//
// One line per group: sources of the group, sources with a differing record, records by class, and the
// loaders that differ. Exit code 1 when a group of seams.mjs has no differing record (only of use for a
// run against the round-1 binary, which must differ in every group but the `guard.` ones).
import { readFileSync } from "node:fs";
import { SEAMS } from "./seams.mjs";

const [path, flag] = process.argv.slice(2);
const records = readFileSync(path, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => JSON.parse(line));
const loaderOf = api => api.split(".")[1];
let unseen = 0;
for (const [prod, list] of Object.entries(SEAMS)) {
  const mine = records.filter(d => d.prod === prod);
  const sources = new Map();
  const classes = {};
  const loaders = {};
  for (const d of mine) {
    if (!sources.has(d.src)) sources.set(d.src, []);
    sources.get(d.src).push(`${d.api} ${d.cls}`);
    classes[d.cls] = (classes[d.cls] ?? 0) + 1;
    const key = `${d.api[0]}.${loaderOf(d.api)}`;
    loaders[key] = (loaders[key] ?? 0) + 1;
  }
  const seen = sources.size > 0;
  if (!seen && !prod.startsWith("guard.")) unseen++;
  const text = o =>
    Object.entries(o)
      .sort()
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
  console.log(`${seen ? "seen  " : prod.startsWith("guard.") ? "same  " : "UNSEEN"} ${prod.padEnd(36)} ${String(sources.size).padStart(3)} of ${String(list.length).padStart(3)} sources differ, ${String(mine.length).padStart(5)} records  ${text(classes)}  | ${text(loaders)}`);
  if (flag === "--sources") {
    for (const [src, apis] of sources) {
      const byClass = {};
      for (const a of apis) {
        const [api, cls] = a.split(" ");
        (byClass[cls] ??= []).push(api);
      }
      console.log(`         ${JSON.stringify(src)}`);
      for (const [cls, apiList] of Object.entries(byClass)) console.log(`             ${cls} ${apiList.length === 34 ? "every configuration" : apiList.join(" ")}`);
    }
  }
}
process.exit(unseen > 0 ? 1 : 0);
