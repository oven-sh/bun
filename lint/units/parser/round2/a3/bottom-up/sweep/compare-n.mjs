import { readFileSync } from "node:fs";
const files = readFileSync("/tmp/a3-seam/glob-files.txt", "utf8").split("\n").filter(Boolean);
const load = path => { const m = new Map(); for (const line of readFileSync(path, "utf8").split("\n")) { if (!line) continue; const r = JSON.parse(line); if ("index" in r) m.set(r.index + ":" + r.config, r); } return m; };
const [a, b] = [load(process.argv[2]), load(process.argv[3])];
const counts = {};
for (const [key, ra] of a) {
  const rb = b.get(key); const c = ra.config;
  counts[c] ??= { total: 0, equal: 0, differ: 0, bothFail: 0, onlyNormal: 0, onlyLint: 0, missing: 0 };
  counts[c].total++;
  if (!rb) { counts[c].missing++; continue; }
  if (ra.errors && rb.errors) counts[c].bothFail++;
  else if (ra.errors) { counts[c].onlyLint++; console.log("onlyLint", c, files[ra.index], ra.errors[0]); }
  else if (rb.errors) { counts[c].onlyNormal++; console.log("onlyNormal", c, files[ra.index], rb.errors[0]); }
  else if (ra.hash === rb.hash && ra.length === rb.length) counts[c].equal++;
  else { counts[c].differ++; console.log("differ", c, files[ra.index], ra.length, rb.length); }
}
console.log(JSON.stringify(counts));
