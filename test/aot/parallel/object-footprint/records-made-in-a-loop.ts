// A hundred thousand small records that hold references, made in one plain loop and kept in an array. An object that a loop makes is made often, however few
// times the loop itself is entered: its references are narrow and it has no room to spare. A record takes 32 bytes; 48 where its references are wide.
// COUNT: bytes <= 3300000
declare const console: { log(...values: unknown[]): void };
type Leaf = { v: number };
type Item = { a: Leaf; b: Leaf; c: Leaf; d: Leaf; n: number };
const leaf: Leaf = { v: 1 };
const items: Item[] = [];
for (let i = 0; i < 100_000; i++) items.push({ a: leaf, b: leaf, c: leaf, d: leaf, n: i });
let sum = 0;
for (const item of items) sum += item.a.v + item.d.v + item.n;
console.log(sum, items.length);
