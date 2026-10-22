// An optional reference read and followed.
declare const process: { argv: string[] }; declare const console: { log(...values: unknown[]): void };
class Item { id: number; next?: Item; other?: Item; constructor(id: number) { this.id = id; } }
function follow(item: Item): number {
  const next = item.next;
  if (next) return next.id;
  return -1;
}
function followTwo(item: Item): number {
  const a = item.next, b = item.other;
  let t = 0;
  if (a !== undefined) t += a.id;
  if (b) t += b.id;
  return t;
}
const items: Item[] = [];
for (let i = 0; i < 64; i++) { const item = new Item(i); if (i % 8) item.next = items[i - 1]; if (i % 3) item.other = items[i >> 1]; items.push(item); }
const rounds = Number(process.argv[2] ?? 0);
let t = 0;
for (let r = 0; r < rounds; r++) { const item = items[r & 63]; t += follow(item) + followTwo(item); }
console.log(t);
