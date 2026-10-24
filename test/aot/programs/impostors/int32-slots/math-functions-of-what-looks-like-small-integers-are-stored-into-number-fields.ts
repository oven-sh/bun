// Math.min, max, abs, floor, ceil, round and trunc give an int32 for int32 arguments, with one exception: Math.abs(-(2 ** 31)). Every call in sight has small integers.
// Hidden callers bring the arguments for which the results are -0 (Math.round(-0.4), Math.ceil(-0.5), Math.trunc(-0.9), Math.min(0, -0)), NaN, infinities, fractions, and objects with valueOf.
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
class Min { v = 0; }
class Max { v = 0; }
class Abs { v = 0; }
class Floor { v = 0; }
class Ceil { v = 0; }
class Round { v = 0; }
class Trunc { v = 0; }
class AbsOfInt { v = 0; }
function min(o: Min, a: number, b: number) { o.v = Math.min(a, b); }
function max(o: Max, a: number, b: number) { o.v = Math.max(a, b); }
function abs(o: Abs, a: number) { o.v = Math.abs(a); }
function floor(o: Floor, a: number) { o.v = Math.floor(a); }
function ceil(o: Ceil, a: number) { o.v = Math.ceil(a); }
function round(o: Round, a: number) { o.v = Math.round(a); }
function trunc(o: Trunc, a: number) { o.v = Math.trunc(a); }
function absOfInt(o: AbsOfInt, a: number) { o.v = Math.abs(a | 0); }
type Box = { v: number };
function show(o: Box) {
  return `${exact(o.v)} ${exact(o.v + 1)} ${exact(1 / o.v)} ${JSON.stringify(o)}`;
}
function made<T extends object>(o: T) {
  handOver(o);
  return o;
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const a = made(new Min()), b = made(new Max()), c = made(new Abs()), d = made(new Floor()), e = made(new Ceil()), f = made(new Round()), g = made(new Trunc()), h = made(new AbsOfInt());
  min(a, i & 31, 9);
  max(b, i & 31, 9);
  abs(c, (i & 31) - 16);
  floor(d, i & 31);
  ceil(e, i & 31);
  round(f, i & 31);
  trunc(g, i & 31);
  absOfInt(h, (i & 31) - 16);
  sum += a.v + b.v + c.v + d.v + e.v + f.v + g.v + h.v;
}
console.log("warm", sum);
const more: number[] = (JSON.parse('["-0.4","-0.9","0.4","0.49999999999999994","2147483647.5","-2147483648.5","-2147483643.5","1.5","2.5","-1.5"]'.split("").join("")) as string[]).map(Number);
const one: [string, () => Box, Function][] = [
  ["abs", () => made(new Abs()), abs],
  ["floor", () => made(new Floor()), floor],
  ["ceil", () => made(new Ceil()), ceil],
  ["round", () => made(new Round()), round],
  ["trunc", () => made(new Trunc()), trunc],
  ["abs of | 0", () => made(new AbsOfInt()), absOfInt],
];
for (const [label, make, run] of one) {
  console.log(label + ":", [...odd, ...more].map(value => { const o = make(); run.call(undefined, o, value); return `${exact(value)} -> ${show(o)}`; }).join(" | "));
}
const pairs: [number, number][] = [[0, -0], [-0, 0], [-0, -0], [1, NaN], [NaN, 1], [Infinity, 1], [-Infinity, 1], [0.5, 1], [2147483648, 2147483647], [-2147483648, -2147483643], [-2147483649, 0]].map(([a, b]) => [Number(String(Object.is(a, -0) ? "-0" : a)), Number(String(Object.is(b, -0) ? "-0" : b))]);
for (const [a, b] of pairs) {
  const low = made(new Min()), high = made(new Max());
  Reflect.apply(min, undefined, [low, a, b]);
  Reflect.apply(max, undefined, [high, a, b]);
  console.log(`min and max of ${exact(a)}, ${exact(b)}: ${show(low)} | ${show(high)}`);
}
const calls: string[] = [];
const convertible = (label: string, value: number) => ({ valueOf() { calls.push(label); return value; } });
const low = made(new Min()), rounded = made(new Round());
min.call(undefined, low, convertible("first", 0.25) as any, convertible("second", 3) as any);
round.call(undefined, rounded, convertible("third", -0.25) as any);
console.log("objects with valueOf:", show(low), "|", show(rounded), "|", calls.join());
