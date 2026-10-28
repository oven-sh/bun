// Five million small records that hold references, made in one plain loop and kept in an array. An object that a loop makes is made often, however few
// times the loop itself is entered: its references are narrow and it has no room to spare. Measured: 222 to 238 MB; 305 to 319 MB where they counted as made seldom; 369 MB and more in plain Bun.
// Kept after a collection, by the engine's own count: 190.7 MB; 267.0 MB where their references are wide; 343.5 MB in plain Bun.
// Alone: it measures time, memory or what is collected, and that depends on what the compiler knows about the whole executable
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number; heapUsed: number } };
declare const Bun: { gc(isSynchronous: boolean): void };
Bun.gc(true);
const usedBefore = process.memoryUsage().heapUsed;
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
console.log("grew by less than 270 MB:", grown < 270 * 1024 * 1024);
Bun.gc(true);
const kept = process.memoryUsage().heapUsed - usedBefore;
console.log("what is kept takes less than 229 MB of the heap:", kept < 229 * 1024 * 1024);
console.log(items.length);
/* Output:
12500007500000 5000000
grew by less than 270 MB: true
what is kept takes less than 229 MB of the heap: true
5000000
*/
