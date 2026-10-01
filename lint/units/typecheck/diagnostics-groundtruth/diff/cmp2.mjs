import fs from "node:fs";
const g = fs.readFileSync("go.cmp","utf8").split("\n"), r = fs.readFileSync("rust.cmp","utf8").split("\n");
let cur = ""; const kinds = {}; const un = h => h === "-" ? "" : Buffer.from(h, "hex").toString("latin1");
let shown = 0;
for (let i = 0; i < g.length; i++) {
  const a = g[i], b = r[i]; const k = a.split(" ")[0];
  if (k === "CASE") cur = a.split(" ")[1];
  if (a !== b && k === "SORTED") {
    const kind = cur.replace(/\d+$/, ""); kinds[kind] = (kinds[kind] || 0) + 1;
    if (kind !== "tie" && shown < 2) { shown++; const x = un(a.split(" ")[1]).split("\n"), y = un(b.split(" ")[1]).split("\n"); console.log("case", cur); for (let j = 0; j < Math.max(x.length, y.length); j++) if (x[j] !== y[j]) console.log("  go  :", x[j], "\n  rust:", y[j]); }
  }
}
console.log(kinds);
