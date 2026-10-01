import { readFileSync } from "node:fs";
const split = readFileSync("split.tsv", "utf8").split("\n").filter(Boolean).slice(1).map(l => l.split("\t"));
const inst = readFileSync("inst.tsv", "utf8").split("\n").filter(Boolean);
const head = inst[0].split("\t");
const rows = inst.slice(1).map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])));
const cfg = new Map(rows.map(r => [r.suite + "/" + r.name, r]));
let hits: string[] = [];
for (const s of split) {
  const names = [s[4], ...(s[5] ?? "").split("|"), ...(s[6] ?? "").split("|")].filter(Boolean);
  const lower = new Map<string, string>();
  let dup: string[] = [];
  for (const n of names) {
    const k = n.toLowerCase();
    if (lower.has(k) && lower.get(k) !== n) dup.push(lower.get(k) + " ~ " + n);
    lower.set(k, n);
  }
  // a file name that equals a directory prefix of another in another case
  const dirs = new Map<string, string>();
  for (const n of names) {
    const parts = n.split("/");
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join("/");
      const k = d.toLowerCase();
      if (dirs.has(k) && dirs.get(k) !== d) dup.push("dir " + dirs.get(k) + " ~ " + d);
      else if (!dirs.has(k)) dirs.set(k, d);
    }
  }
  if (dup.length) hits.push(s[0] + "/" + s[1] + " :: " + [...new Set(dup)].join("; ") + " :: " + (cfg.get(s[0] + "/" + s[1])?.configuration ?? ""));
}
console.log("run instances whose unit names collide without case:", hits.length);
for (const h of hits) console.log(" ", h.slice(0, 400));
