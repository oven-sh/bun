// `stats.total += item.size` in a loop: every addend is an int32 and so is the total for a long time. In the middle of one loop the sum passes 2 ** 31, in another it falls below -(2 ** 31) + 5,
// and the loop goes on adding. Sums and differences of two values that went through `| 0` leave int32 without any loop. All operands are int32; only the size of half a billion comes by a hidden call.
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
class Stats { total = 0; count = 0; least = 0; }
class Item { constructor(public size: number) {} }
class Pair { sum = 0; difference = 0; next = 0; previous = 0; }
function addAll(stats: Stats, items: Item[]) {
  for (let i = 0; i < items.length; i++) {
    stats.total += items[i].size;
    stats.count++;
  }
  return stats.total;
}
function subtractAll(stats: Stats, items: Item[]) {
  for (const item of items) stats.least -= item.size;
  return stats.least;
}
function addMany(stats: Stats, size: number, rounds: number) {
  const marks: string[] = [];
  for (let i = 0; i < rounds; i++) {
    stats.total += size | 0;
    if (i >= rounds - 4) marks.push(exact(stats.total));
  }
  return marks.join(" ");
}
function combine(pair: Pair, a: number, b: number) {
  const x = a | 0, y = b | 0;
  pair.sum = x + y;
  pair.difference = x - y;
  pair.next = x + 1;
  pair.previous = y - 1;
}
function made<T extends object>(object: T) {
  handOver(object);
  return object;
}
function items(size: number, count: number) {
  const list: Item[] = [];
  for (let i = 0; i < count; i++) list.push(made(new Item(size)));
  return list;
}
let sum = 0;
for (let i = 0; i < 1000; i++) {
  const stats = made(new Stats()), pair = made(new Pair());
  sum += addAll(stats, items(i & 7, 4)) + subtractAll(stats, items(1, 2));
  combine(pair, i, 3);
  sum += pair.sum + pair.difference + pair.next + pair.previous;
}
console.log("warm", sum);
const large = Number(JSON.parse('"500000000"'));
{
  const stats = made(new Stats());
  const list = items.call(undefined, large, 9);
  console.log("nine times half a billion:", exact(addAll(stats, list)), exact(subtractAll(stats, list)), JSON.stringify(stats), exact(stats.total + stats.least));
  console.log("and nine times more:", exact(addAll(stats, list)), exact(subtractAll(stats, list)), JSON.stringify(stats));
}
{
  const stats = made(new Stats());
  console.log("the last four of 4300 steps of 499999:", addMany(stats, 499999, 4300), JSON.stringify(stats));
  const down = made(new Stats());
  console.log("the last four of 4300 steps down:", addMany(down, -499999, 4300), JSON.stringify(down));
  const edge = made(new Stats());
  Reflect.set(edge, "total", -2147483640);
  console.log("through the smallest values:", addMany(edge, -1, 4), addMany(edge, -1, 4), addMany(edge, -1, 4), JSON.stringify(edge));
}
for (const [a, b] of JSON.parse("[[2147483647,1],[2147483647,2147483647],[-2147483648,1],[-2147483648,-2147483648],[-2147483648,2147483647],[-2147483643,1],[-2147483642,2],[0,0],[1073741824,1073741824]]") as [number, number][]) {
  const pair = made(new Pair());
  combine(pair, a, b);
  console.log(`${a}, ${b}: ${exact(pair.sum)} ${exact(pair.difference)} ${exact(pair.next)} ${exact(pair.previous)} ${JSON.stringify(pair)}`);
}
