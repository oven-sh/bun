// Five million records made by a function that another function calls, which a loop calls: what is made below a loop is made often too.
// Measured: 204 to 250 MB; 311 to 315 MB where they counted as made seldom; 370 MB and more in plain Bun.
// With the types erased the records need 286 to 320 MB today, so that build prints what plain Bun prints and no .erased.txt stands beside this file.
// The bound lies as far above the one as below the other.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number } };
const before = process.memoryUsage().rss;
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
const grown = process.memoryUsage().rss - before;
console.log(sum, items.length);
console.log("grew by less than 268 MB:", grown < 268 * 1024 * 1024);
