import fs from "node:fs";
const g = fs.readFileSync("go.cmp","utf8").split("\n"), r = fs.readFileSync("rust.cmp","utf8").split("\n");
console.log("lines", g.length, r.length);
const stats = {}; let cur = ""; const bad = {};
for (let i = 0; i < Math.max(g.length, r.length); i++) {
  const a = g[i] ?? "", b = r[i] ?? "";
  const kind = a.split(" ")[0];
  if (kind === "CASE") cur = a.split(" ")[1];
  stats[kind] ??= { same: 0, diff: 0 };
  if (a === b) stats[kind].same++; else { stats[kind].diff++; (bad[kind] ??= []).push([i, cur, a.slice(0, 300), b.slice(0, 300)]); }
}
console.log(JSON.stringify(stats, null, 1));
for (const [k, v] of Object.entries(bad)) { console.log("==", k, v.length); for (const x of v.slice(0, 6)) console.log(x[0], x[1], "\n  go  :", x[2], "\n  rust:", x[3]); }
