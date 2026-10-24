// Four million records made by a callback that a built-in calls for each element of an array.
// Measured: 293 to 303 MB; 340 MB in plain Bun.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number } };
const before = process.memoryUsage().rss;
type Leaf = { v: number };
type Row = { name: string; owner: Leaf; next: Leaf | null; tag: string; n: number };
const leaf: Leaf = { v: 2 };
const numbers: number[] = [];
for (let i = 0; i < 4_000_000; i++) numbers.push(i);
const rows: Row[] = numbers.map(n => ({ name: "row", owner: leaf, next: n % 2 ? leaf : null, tag: "t", n }));
let sum = 0;
for (const row of rows) sum += row.owner.v + row.n + row.name.length;
const grown = process.memoryUsage().rss - before;
console.log(sum, rows.length);
console.log("grew by less than 320 MB:", grown < 320 * 1024 * 1024);
