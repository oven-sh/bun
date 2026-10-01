import { execFileSync } from "node:child_process";
const M = "/workspace/notes/lint/measure/parser";
const run = bin => execFileSync(`${M}/${bin}/bun`, ["/tmp/a1bu/p/minid.mjs", process.argv[2]], { encoding: "utf8", maxBuffer: 1 << 30 }).split("\n").filter(Boolean).map(l => JSON.parse(l));
const b = run("base"), h = run("head");
let n = 0, diff = 0;
const cls = {};
for (let i = 0; i < b.length; i++) {
  for (const k of Object.keys(b[i].out)) {
    n++;
    const x = JSON.stringify(b[i].out[k]), y = JSON.stringify(h[i].out[k]);
    if (x === y) continue;
    diff++;
    const c = `${k} ${b[i].out[k][0] === "e" ? "R" : "A"}>${h[i].out[k][0] === "e" ? "R" : "A"}`;
    cls[c] = (cls[c] ?? 0) + 1;
    if (cls[c] <= 3) console.log(`${c}  ${JSON.stringify(b[i].src).slice(0, 150)}\n    base ${x.slice(0, 200)}\n    head ${y.slice(0, 200)}`);
  }
}
console.log(`${b.length} sources, ${n} records, ${diff} differ`, cls);
