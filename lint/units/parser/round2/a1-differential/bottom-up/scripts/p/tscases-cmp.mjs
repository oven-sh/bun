import { readFileSync, writeFileSync } from "node:fs";
const units = JSON.parse(readFileSync("/tmp/a1bu/p/tscases.json", "utf8"));
const [a, b] = ["base", "head"].map(t => readFileSync(`/tmp/a1bu/runs/tscases.${t}.jsonl`, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)));
const cls = {};
const ra = [];
const aa = [];
for (let i = 0; i < units.length; i++) {
  for (let k = 0; k < 2; k++) {
    const x = a[i][k], y = b[i][k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const c = `${k ? "deco" : "plain"} ${x[0] === "e" ? "R" : "A"}>${y[0] === "e" ? "R" : "A"}`;
    cls[c] = (cls[c] ?? 0) + 1;
    if (x[0] === "e" && y[0] !== "e" && k === 0) ra.push({ i, prod: units[i].prod, tsx: units[i].tsx, base: x[1] });
    if (x[0] !== "e" && y[0] !== "e") aa.push({ i, k, prod: units[i].prod, base: x[1], head: y[1] });
    if (x[0] !== "e" && y[0] === "e") console.log("A>R !!", units[i].prod, JSON.stringify(y[1]).slice(0, 200));
  }
}
console.log(units.length, "units", cls);
writeFileSync("/tmp/a1bu/runs/tscases.ra.json", JSON.stringify(ra));
writeFileSync("/tmp/a1bu/runs/tscases.aa.json", JSON.stringify(aa));
