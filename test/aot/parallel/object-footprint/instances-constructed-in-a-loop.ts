// A hundred thousand instances of a class that hold references, constructed in one plain loop and kept in an array. An instance takes 32 bytes; 48 where its references are wide.
// COUNT: bytes <= 3300000
declare const console: { log(...values: unknown[]): void };
class Leaf {
  constructor(public v: number) {}
}
class Item {
  constructor(
    public a: Leaf,
    public b: Leaf,
    public c: Leaf,
    public d: Leaf,
    public n: number,
  ) {}
}
const leaf = new Leaf(1);
const items: Item[] = [];
for (let i = 0; i < 100_000; i++) items.push(new Item(leaf, leaf, leaf, leaf, i));
let sum = 0;
for (const item of items) sum += item.a.v + item.d.v + item.n;
console.log(sum, items.length);
