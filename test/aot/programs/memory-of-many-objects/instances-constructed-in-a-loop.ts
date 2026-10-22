// Five million instances of a class that hold references, constructed in one plain loop and kept in an array.
// Measured: 228 to 236 MB; 302 to 315 MB where they counted as made seldom; 369 MB in plain Bun.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number } };
const before = process.memoryUsage().rss;
class Leaf { constructor(public v: number) {} }
class Item {
  constructor(public a: Leaf, public b: Leaf, public c: Leaf, public d: Leaf, public n: number) {}
}
const leaf = new Leaf(1);
const items: Item[] = [];
for (let i = 0; i < 5_000_000; i++) items.push(new Item(leaf, leaf, leaf, leaf, i));
let sum = 0;
for (const item of items) sum += item.a.v + item.d.v + item.n;
const grown = process.memoryUsage().rss - before;
console.log(sum, items.length);
console.log("grew by less than 275 MB:", grown < 275 * 1024 * 1024);
