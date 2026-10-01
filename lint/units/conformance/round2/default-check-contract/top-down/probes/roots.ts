import { readFileSync } from "node:fs";
const recs = readFileSync("/tmp/dcc/raw-release.jsonl", "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const by = new Map<string, number>();
const inc = (k: string) => by.set(k, (by.get(k) ?? 0) + 1);
const isDts = (r: string) => /\.d\.[mc]?ts$/.test(r);
const isJs = (r: string) => /\.(?:js|jsx|mjs|cjs)$/.test(r);
const hasLoader = (r: string) => /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.test(r);
let laid = 0;
const names: string[] = [];
for (const r of recs) {
  if (r.roots === undefined) { inc(`${r.kind} not laid out`); continue; }
  laid++;
  const roots: string[] = r.roots;
  if (roots.length === 0) inc(`${r.kind} no root`);
  if (roots.length > 0 && roots.every(isDts)) { inc(`${r.kind} only declaration roots: exit ${r.exitCode}, stderr ${r.stderr === "" ? "empty" : "not empty"}`); }
  if (roots.some(isJs)) inc(`${r.kind} has a JavaScript root`);
  if (roots.some(x => !hasLoader(x))) { inc(`${r.kind} has a root without a loader`); names.push(`${r.name}: ${roots.filter(x => !hasLoader(x)).join(" ")}`); }
  if (roots.length > 1) inc(`${r.kind} more than one root`);
  if (roots.some(isDts) && !roots.every(isDts)) inc(`${r.kind} some declaration roots`);
}
console.log("laid out", laid);
for (const [k, n] of [...by].sort()) console.log(String(n).padStart(6), k);
console.log(names.join("\n"));
