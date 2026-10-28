// Only the inner object is kept. The outer one is garbage to the program, collections run, and objects of the same kind are made and kept for a while: they take every cell that was given back.
interface Inner { d: number; e: number; s: string }
interface Outer { b: number; c: Inner; t: string }
function make(i: number): Outer {
  return { b: i, c: { d: i + 1, e: i + 2, s: "s" + i }, t: "t" + i };
}
const kept: Inner[] = [];
const ring: (Outer | null)[] = new Array(4096).fill(null);
function churn(n: number, from: number): number {
  let x = 0;
  for (let i = 0; i < n; i++) {
    const o = make(from + i);
    ring[i & 4095] = o;
    x += o.c.d & 7;
  }
  return x;
}
for (let i = 0; i < 20000; i++) {
  const a = make(i);
  ring[i & 4095] = a;
  if (i % 7 === 0) kept.push(a.c);
}
let noise = 0;
for (let round = 0; round < 6; round++) {
  ring.fill(null);
  Bun.gc(true);
  noise += churn(50000, 1000000 * (round + 1));
}
let sum = 0;
let text = "";
for (let k = 0; k < kept.length; k++) {
  const c = kept[k];
  if (c.d !== k * 7 + 1 || c.e !== k * 7 + 2 || c.s !== "s" + k * 7) { text = "WRONG at " + k + ": " + c.d + " " + c.e + " " + c.s; break; }
  sum += c.d * 3 + c.e;
}
console.log(kept.length, sum, text, noise);
