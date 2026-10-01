import { readFileSync } from "node:fs";
const lines = readFileSync("inst.tsv", "utf8").split("\n").filter(Boolean);
const head = lines[0].split("\t");
const rows = lines.slice(1).map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
const run = rows.filter(r => r.status === "run");
console.log("rows", rows.length, "run", run.length, "skipped", rows.length - run.length);
let withOpt = 0;
const freq = new Map<string, number>();
const sets = new Map<string, number>();
const kinds = { E: 0, C: 0 } as Record<string, number>;
let onlyTargetE = 0, onlyTargetC = 0;
const nopt: any[] = [];
for (const r of run) {
  kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  const c = r.configuration ? JSON.parse(r.configuration) : {};
  const keys = Object.keys(c);
  if (keys.length) withOpt++; else nopt.push(r.suite + "/" + r.name);
  for (const k of keys) freq.set(k, (freq.get(k) ?? 0) + 1);
  const key = keys.sort().join(",");
  sets.set(key, (sets.get(key) ?? 0) + 1);
}
console.log("kinds", kinds, "with option", withOpt, "without", run.length - withOpt);
console.log("without option:", nopt.join(" "));
console.log("distinct option names", freq.size);
console.log([...freq].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "));
console.log("distinct option sets", sets.size);
console.log([...sets].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v}\t${k}`).join("\n"));
