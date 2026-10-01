import { readFileSync } from "node:fs";
const lib = new Set(readFileSync("libcases.txt", "utf8").split("\n").filter(Boolean));
const lines = readFileSync("/dev/stdin", "utf8").split("\n").filter(Boolean);
const head = lines[0].split("\t");
const rows = lines.slice(1).map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
let n = 0, e = 0, c = 0, skipped = 0;
for (const r of rows) {
  if (!lib.has(r.casePath)) continue;
  if (r.status !== "run") { skipped++; continue; }
  n++; if (r.kind === "E") e++; else c++;
}
console.log({ caseFiles: lib.size, runInstances: n, E: e, C: c, skippedInstances: skipped });
