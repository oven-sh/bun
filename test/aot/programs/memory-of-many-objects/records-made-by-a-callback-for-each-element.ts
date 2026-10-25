// Four million records made by a callback that a built-in calls for each element of an array.
// The process grows by 290 to 306 MB, and by 333 to 348 MB in plain Bun: too close to tell apart on a busy machine, so the heap is asked.
// Kept after a collection, by the engine's own count: 213.6 MB; 274.7 MB in plain Bun.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { heapUsed: number } };
declare const Bun: { gc(isSynchronous: boolean): void };
Bun.gc(true);
const usedBefore = process.memoryUsage().heapUsed;
type Leaf = { v: number };
type Row = { name: string; owner: Leaf; next: Leaf | null; tag: string; n: number };
const leaf: Leaf = { v: 2 };
const numbers: number[] = [];
for (let i = 0; i < 4_000_000; i++) numbers.push(i);
const rows: Row[] = numbers.map(n => ({ name: "row", owner: leaf, next: n % 2 ? leaf : null, tag: "t", n }));
let sum = 0;
for (const row of rows) sum += row.owner.v + row.n + row.name.length;
console.log(sum, rows.length);
Bun.gc(true);
const kept = process.memoryUsage().heapUsed - usedBefore;
console.log("what is kept takes less than 244 MB of the heap:", kept < 244 * 1024 * 1024);
console.log(rows.length);
