// Two, three and four values are written, and the loop behind them asks room for fewer: none, one, two turns. Thousands of such lists lie side by side and are kept while the collector runs: each holds what was written and pushed, and no list has written over its neighbor.
"use strict";
const seed = JSON.parse('[10, 20, 30, 40]');
function two(a, n) { const list = [a, a + seed[0]]; for (let i = 0; i < n; i++) list.push(i); return list; }
function three(a, n) { const list = [a, a + seed[0], a + seed[1]]; for (let i = 0; i < n; i++) list.push(i); return list; }
function four(a, n) { const list = [a, a + seed[0], a + seed[1], a + seed[2]]; for (let i = 0; i < n; i++) list.push(i); return list; }
function texts(a, n) { const list = ["t" + a, "u" + a, "v" + a]; for (let i = 0; i < n; i++) list.push(i); return list; }
const kept = [];
for (let round = 0; round < 30; round++) {
  for (let a = 0; a < 100; a++) {
    const n = a % 3;
    kept.push([2, a, n, two(a, n)], [3, a, n, three(a, n)], [4, a, n, four(a, n)], [0, a, n, texts(a, n)]);
  }
  if (typeof Bun !== "undefined") Bun.gc(true);
}
let sum = 0;
for (const [written, a, n, list] of kept) {
  const count = written || 3;
  if (list.length !== count + n) throw new Error("length " + list.length + " of " + written + ", " + n);
  for (let i = 0; i < count; i++) {
    const wanted = written ? a + (i ? seed[i - 1] : 0) : "tuv"[i] + a;
    if (list[i] !== wanted) throw new Error("written " + i + " of " + written + ": " + list[i]);
  }
  for (let i = 0; i < n; i++) if (list[count + i] !== i) throw new Error("pushed " + i);
  list.push("last");
  sum += list.length;
}
console.log(kept.length, sum);
