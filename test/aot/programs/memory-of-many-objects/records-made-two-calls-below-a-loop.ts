// Five million records made by a function that another function calls, which a loop calls: what is made below a loop is made often too.
// With the types erased the records are wider today, so that build prints what plain Bun prints and no .erased.txt stands beside this file.
// The process grows by 204 to 250 MB, and by 286 to 321 MB with the types erased: too close to tell apart on a busy machine, so the heap is asked.
// Kept after a collection, by the engine's own count: 190.7 MB; 267.0 MB with the types erased; 343.5 MB in plain Bun.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { heapUsed: number } };
declare const Bun: { gc(isSynchronous: boolean): void };
Bun.gc(true);
const usedBefore = process.memoryUsage().heapUsed;
type Leaf = { v: number };
type Item = { a: Leaf; b: Leaf; c: Leaf; d: Leaf; n: number; label: string };
const leaf: Leaf = { v: 1 };
function make(n: number, label: string): Item {
  if (n < 0) throw new Error("negative");
  return { a: leaf, b: leaf, c: leaf, d: leaf, n, label };
}
function makeNamed(n: number): Item {
  return make(n, n % 2 ? "odd" : "even");
}
const items: Item[] = [];
for (let i = 0; i < 5_000_000; i++) items.push(makeNamed(i));
let sum = 0;
for (const item of items) sum += item.a.v + item.d.v + item.n + item.label.length;
console.log(sum, items.length);
Bun.gc(true);
const kept = process.memoryUsage().heapUsed - usedBefore;
console.log("what is kept takes less than 229 MB of the heap:", kept < 229 * 1024 * 1024);
console.log(items.length);
