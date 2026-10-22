// Five million small records that hold references, made in one plain loop and kept in an array. An object that a loop makes is made often, however few
// times the loop itself is entered: its references are narrow and it has no room to spare. Measured: 222 to 229 MB; 305 to 319 MB where they counted as made seldom; 369 MB and more in plain Bun.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number } };
const before = process.memoryUsage().rss;
type Leaf = { v: number };
type Item = { a: Leaf; b: Leaf; c: Leaf; d: Leaf; n: number };
const leaf: Leaf = { v: 1 };
const items: Item[] = [];
for (let i = 0; i < 5_000_000; i++) items.push({ a: leaf, b: leaf, c: leaf, d: leaf, n: i });
let sum = 0;
for (const item of items) sum += item.a.v + item.d.v + item.n;
const grown = process.memoryUsage().rss - before;
console.log(sum, items.length);
console.log("grew by less than 265 MB:", grown < 265 * 1024 * 1024);
