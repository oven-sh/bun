// usage: bun cmp.mjs <a.jsonl> <b.jsonl> [--show]
import { readFileSync } from "node:fs";
const [aPath, bPath, ...flags] = process.argv.slice(2);
const show = flags.includes("--show");
const load = path => {
  const map = new Map(); let done = null, lastStart = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (r.done) { done = r; continue; }
    if ("start" in r) { lastStart = r; continue; }
    map.set(r.config + "\t" + r.file, r); lastStart = null;
  }
  return { map, done, lastStart };
};
const A = load(aPath), B = load(bPath);
const byConfig = {};
for (const [key, a] of A.map) {
  const b = B.map.get(key);
  if (!b) continue;
  const c = (byConfig[a.config] ??= { total: 0, equal: 0, differ: [], bothFail: 0, bothFailSameErrors: 0, aOnly: [], bOnly: [] });
  c.total++;
  if (a.code !== undefined && b.code !== undefined) {
    if (a.code === b.code) c.equal++; else {
      let at = 0; while (a.code[at] === b.code[at]) at++;
      c.differ.push({ file: a.file, at, a: a.code.slice(Math.max(0, at - 60), at + 100), b: b.code.slice(Math.max(0, at - 60), at + 100) });
    }
  } else if (a.code !== undefined) c.aOnly.push({ file: a.file, errors: b.errors });
  else if (b.code !== undefined) c.bOnly.push({ file: a.file, errors: a.errors });
  else { c.bothFail++; if (JSON.stringify(a.errors) === JSON.stringify(b.errors)) c.bothFailSameErrors++; else (c.bothFailDiff ??= []).push({ file: a.file, a: a.errors, b: b.errors }); }
}
for (const [config, c] of Object.entries(byConfig)) {
  console.log(config, JSON.stringify({ total: c.total, equal: c.equal, differ: c.differ.length, aOnly: c.aOnly.length, bOnly: c.bOnly.length, bothFail: c.bothFail, bothFailSameErrors: c.bothFailSameErrors }));
  if (show) {
    for (const d of c.differ) console.log("  DIFFER", JSON.stringify(d));
    for (const d of c.aOnly) console.log("  A-ONLY", JSON.stringify(d));
    for (const d of c.bOnly) console.log("  B-ONLY", JSON.stringify(d));
    for (const d of c.bothFailDiff ?? []) console.log("  BOTHFAIL-DIFF", JSON.stringify(d));
  }
}
console.log("done a", JSON.stringify(A.done), "last", JSON.stringify(A.lastStart));
console.log("done b", JSON.stringify(B.done), "last", JSON.stringify(B.lastStart));
