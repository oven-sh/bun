// Math.min() is Infinity and Math.max() is -Infinity: with nothing to compare, no argument is anything but an int32. The lists that are spread into the calls hold small integers wherever the build looks;
// at run time one of them is empty, one holds a hole, one holds a fraction, and one is so long that it holds 2 ** 31 at its end.
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
class Low { v = 0; }
class High { v = 0; }
class Bare { low = 0; high = 0; }
function lowest(o: Low, a: number, b: number, c: number, count: number) {
  const list = [a, b, c];
  list.length = count;
  o.v = Math.min(...list);
}
function highest(o: High, list: number[]) {
  o.v = Math.max(...list);
}
function bare(o: Bare, really: boolean) {
  o.low = really ? Math.min() : 1;
  o.high = really ? Math.max() : 2;
}
function made<T extends object>(o: T) {
  handOver(o);
  return o;
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const a = made(new Low()), b = made(new High()), c = made(new Bare());
  lowest(a, i & 7, 3, 5, 3);
  highest(b, [i & 7, 3, 5]);
  bare(c, false);
  sum += a.v + b.v + c.low + c.high;
}
console.log("warm", sum);
const show = (o: object) => Object.values(o).map(exact).join(",") + " " + JSON.stringify(o);
for (const count of JSON.parse("[3,2,0,4]") as number[]) {
  const o = made(new Low());
  lowest.call(undefined, o, 4, 5, 6, count);
  console.log("the lowest of", count, "->", show(o), exact(o.v + 1));
}
for (const list of JSON.parse("[[],[1,2.5],[2147483647,2147483648],[-2147483648],[null],[1,\"2\"]]") as number[][]) {
  const o = made(new High());
  highest.call(undefined, o, list);
  console.log("the highest of", JSON.stringify(list), "->", show(o), exact(o.v - 1));
}
const o = made(new Bare());
bare(o, process.argv.length < 99);
console.log("no arguments:", show(o), exact(o.low - o.high), exact(o.low + o.high));
