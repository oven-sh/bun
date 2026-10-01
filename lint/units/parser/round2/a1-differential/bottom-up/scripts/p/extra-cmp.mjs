import { readFileSync } from "node:fs";
const names = ["t.ts.plain.minid", "t.js.plain", "t.jsx.plain"];
const [a, b] = process.argv.slice(2, 4).map(p => readFileSync(p, "utf8").split("\n").filter(Boolean));
const cls = {};
const ex = {};
for (let i = 0; i < a.length; i++) {
  const x = JSON.parse(a[i]), y = JSON.parse(b[i]);
  for (let k = 0; k < 3; k++) {
    const p = JSON.stringify(x.res[k]), q = JSON.stringify(y.res[k]);
    if (p === q) continue;
    const c = `${names[k]} ${x.res[k][0] === "e" ? "R" : "A"}>${y.res[k][0] === "e" ? "R" : "A"}`;
    cls[c] = (cls[c] ?? 0) + 1;
    (ex[c] ??= []).length < 4 && ex[c].push([x.src, p.slice(0, 150), q.slice(0, 150)]);
  }
}
console.log(a.length, "sources", cls);
for (const [c, list] of Object.entries(ex)) for (const [s, p, q] of list) console.log(`${c}  ${JSON.stringify(s).slice(0, 120)}\n    base ${p}\n    head ${q}`);
