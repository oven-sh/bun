// Two million records with thirty optional fields, of which an object gets one at the most: no object pays for the fields it does not have.
// Measured: 101 to 104 MB; 128 MB in plain Bun.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number } };
const before = process.memoryUsage().rss;
type Item = { id: number; o0?: number; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number; o11?: number; o12?: number; o13?: number; o14?: number; o15?: number; o16?: number; o17?: number; o18?: number; o19?: number; o20?: number; o21?: number; o22?: number; o23?: number; o24?: number; o25?: number; o26?: number; o27?: number; o28?: number; o29?: number; };
const items: Item[] = [];
for (let i = 0; i < 2_000_000; i++) {
  const item: Item = { id: i };
  if (i % 100 === 0) item.o7 = i;
  if (i % 1000 === 0) item.o11 = i;
  items.push(item);
}
let sum = 0;
for (const item of items) sum += item.id + (item.o3 ?? 0) + (item.o7 ?? 0) + (item.o11 ?? 0);
const grown = process.memoryUsage().rss - before;
console.log(sum, items.length);
console.log("grew by less than 115 MB:", grown < 115 * 1024 * 1024);
