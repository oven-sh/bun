// Once a fraction has arrived in a field that looks like int32, the object is copied in every way there is: spread, Object.assign, structuredClone, JSON, a constructor that takes the old object,
// Object.entries and fromEntries, destructuring with rest. The copies must hold the same number under the same key in the same place, and the original must be unharmed.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Item {
  first = 1;
  n = 0;
  last = 2;
  constructor(from?: Item) {
    if (from) {
      this.first = from.first;
      this.n = from.n;
      this.last = from.last;
    }
  }
}
interface Shape { first: number; n: number; last: number }
function spreadTyped(item: Item): Shape {
  return { ...item };
}
function rebuilt(item: Item): Shape {
  return { first: item.first, n: item.n, last: item.last };
}
function reordered(item: Item): Shape {
  return { last: item.last, n: item.n, first: item.first };
}
function nOf(shape: Shape) {
  return shape.n;
}
const copies: [string, (item: Item) => Shape][] = [
  ["spread", spreadTyped],
  ["a literal field by field", rebuilt],
  ["a literal in another order", reordered],
  ["Object.assign onto a literal", item => Object.assign({ first: 0, n: 0, last: 0 }, item)],
  ["Object.assign onto an instance", item => Object.assign(new Item(), item)],
  ["the constructor", item => new Item(item)],
  ["structuredClone", item => structuredClone(item)],
  ["entries", item => Object.fromEntries(Object.entries(item)) as unknown as Shape],
  ["rest", item => { const { first, ...rest } = item; return { first, ...rest }; }],
  ["Object.create with descriptors", item => Object.create(Item.prototype, Object.getOwnPropertyDescriptors(item))],
];
let sum = 0;
for (let i = 0; i < 1500; i++) {
  const item = new Item();
  handOver(item);
  item.n = i & 31;
  for (const [, copy] of copies) sum += nOf(copy(item));
}
console.log("warm", sum);
const key: string = JSON.parse('"n"');
for (const value of odd) {
  const item = new Item();
  handOver(item);
  Reflect.set(item, key, value);
  const results = copies.map(([label, copy]) => {
    const made = copy(item);
    return `${label} ${Object.is(nOf(made), value)} ${exact(made.n)} [${Object.keys(made)}]`;
  });
  console.log(`${exact(value)}: ${results.join("; ")} | json ${JSON.stringify(item)} ${JSON.stringify(JSON.parse(JSON.stringify(item)))} | ${exact(item.n)} [${Object.keys(item)}]`);
}
