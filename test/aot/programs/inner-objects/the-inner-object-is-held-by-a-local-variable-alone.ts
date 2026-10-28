// The field is pointed elsewhere and the old inner object lives on in a local variable alone, over collections: the collector finds it by a pointer into the middle of a cell.
import { fullGC } from "bun:jsc";
interface Leaf { v: number; w: string }
interface Inner { d: number; s: string; leaf: Leaf }
interface Outer { b: number; c: Inner }
function make(i: number): Outer { return { b: i, c: { d: i, s: "s" + i, leaf: { v: i, w: "w" + i } } }; }
const spare: Inner = { d: -1, s: "spare", leaf: { v: -1, w: "spare" } };
const pool: (Outer | null)[] = [];
const ring: (Outer | null)[] = new Array(2048).fill(null);
function churn(from: number): number {
  let x = 0;
  fullGC();
  for (let i = 0; i < 6000; i++) { const o = make(from + i); ring[i & 2047] = o; x += o.c.leaf.v & 3; }
  ring.fill(null);
  fullGC();
  for (let i = 0; i < 6000; i++) { const o = make(from - i); ring[i & 2047] = o; x += o.c.leaf.v & 3; }
  return x;
}
// The outer object stays, its field holds another object.
function holdBesideOuter(index: number): string {
  const a = pool[index]!;
  const x = a.c;
  a.c = spare;
  const n = churn(5000000 + index * 10000);
  return x.d + x.s + x.leaf.v + x.leaf.w + (n & 0);
}
// Nobody holds the outer object.
function holdWithoutOuter(index: number): string {
  const x = pool[index]!.c;
  pool[index] = null;
  const n = churn(7000000 + index * 10000);
  return x.d + x.s + x.leaf.v + x.leaf.w + (n & 0);
}
for (let i = 0; i < 24; i++) pool.push(make(i));
fullGC();
let bad = "";
for (let i = 0; i < 24; i++) {
  const expected = i + "s" + i + i + "w" + i + "0";
  const got = i & 1 ? holdBesideOuter(i) : holdWithoutOuter(i);
  if (got !== expected) { bad = "WRONG at " + i + ": " + got; break; }
}
console.log("done", bad, pool[1]!.c === spare);
