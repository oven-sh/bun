// Between the birth of the inner object and that of the outer one a full collection runs, while the inner object is already kept. So the cell is old and marked when the outer object is filled
// with young strings, and only collections of the young follow.
import { edenGC, fullGC } from "bun:jsc";
interface Inner { d: number }
interface Outer { first: string; c: Inner; second: string }
const keptInner: Inner[] = [];
const keptOuter: Outer[] = [];
const ring: string[] = new Array(512).fill("");
function garbage(n: number): number { let x = 0; for (let i = 0; i < n; i++) { const s = "g" + i + "-" + n; ring[i & 511] = s; x += s.length; } return x; }
function make(i: number, depth: number): Outer {
  if (depth > 0) return make(i, depth - 1);
  const c: Inner = { d: i };
  keptInner.push(c);
  fullGC();
  return { first: "a" + i + "-" + depth, c, second: "b" + i + "-" + depth };
}
function batch(from: number): void { for (let i = from; i < from + 4; i++) keptOuter.push(make(i, 3)); }
let g = 0;
for (let i = 0; i < 100; i += 4) {
  batch(i);
  edenGC(); g += garbage(20000); edenGC(); g += garbage(20000);
}
let bad = "";
for (let i = 0; i < keptOuter.length; i++) {
  const o = keptOuter[i];
  if (o.first !== "a" + i + "-0" || o.second !== "b" + i + "-0" || o.c !== keptInner[i] || o.c.d !== i) { bad = "WRONG at " + i + ": " + o.first + " " + o.second; break; }
}
console.log(keptOuter.length, g, bad);
