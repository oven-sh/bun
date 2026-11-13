// new Array(x): a number is a length, anything else is an element; two and more are elements.
function show(v: any): string {
  if (Array.isArray(v)) return "[" + v.length + ":" + Array.from({ length: Math.min(v.length, 12) }, (_, i) => i in v ? show(v[i]) : "_").join() + "]";
  return Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : v !== null && typeof v === "object" ? "{}" : String(v);
}
function attempt(f: () => any): string { try { return show(f()); } catch (e: any) { return e.constructor.name; } }
class Holder {
  list: any[];
  constructor() { this.list = new Array(size as any); }
  fill() { for (let i = 0; i < 3; i++) this.list[i] = { i }; return this.list; }
}
const early = attempt(() => new Holder().list), earlyFilled = attempt(() => new Holder().fill());
var size = 6;
console.log(early, earlyFilled, attempt(() => new Holder().list), attempt(() => new Holder().fill()));
const sources: any[] = JSON.parse('[0, 3, 8, -1, 1.5, 4294967295, 4294967296, 1e21, "3", null, true, [2], {"length": 2}]').concat([undefined, NaN, Infinity, -0, 7n, Symbol.iterator.description]);
function byLength(x: any) { return new Array(x); }
function called(x: any) { return Array(x); }
function optional(x?: number) { return new Array(x as any); }
function filled(x: any) { return new Array(x).fill(0); }
function joined(x: any) { return new Array(x).join("-"); }
for (const x of sources) {
  const large = typeof x === "number" && x > 1e6 && x < 4294967296;
  console.log(show(x), attempt(() => byLength(x).length), attempt(() => called(x).length), attempt(() => optional(x).length), large ? "" : attempt(() => filled(x)), large ? "" : attempt(() => joined(x)));
}
console.log(attempt(() => optional()), attempt(() => optional(undefined)), attempt(() => optional(2)));
function two(a: any, b: any) { return new Array(a, b); }
function three(a: any, b: any, c: any) { return Array(a, b, c); }
for (const a of [1, 0.5, "t", undefined, { v: 1 }, -0]) {
  for (const b of [2, "u", null]) console.log(attempt(() => two(a, b)), attempt(() => three(a, b, a)), attempt(() => two(a, b).map(x => x === undefined)));
}
class Own extends Array<number> {}
console.log(attempt(() => new Own(2, 3)), new Own(2, 3) instanceof Own, attempt(() => new Own(4)), attempt(() => Reflect.construct(Array, [1, 2], Own)), Reflect.construct(Array, [1, 2], Own) instanceof Own, attempt(() => Array.call(null, 5, 6)), attempt(() => Reflect.apply(Array, undefined, [2])));
let total = 0;
for (let i = 0; i < 300; i++) {
  const pair: number[] = new Array(i, i + 0.5);
  const row: number[] = new Array(size);
  row[0] = i;
  row[size - 1] = 1;
  total += pair[0]! + pair[1]! + row.length + row[0]! + row[5]! + (1 in row ? 1 : 0);
}
console.log(total);
const Vector = Array;
const picked = [Array, Object][process.argv.length > 99 ? 1 : 0] as ArrayConstructor;
function made(V: ArrayConstructor) { return new V(); }
function calledFor(V: ArrayConstructor, n?: number) { return n === undefined ? V() : V(n); }
function spread(...rest: any[]) { return new Vector(...rest); }
console.log(show(new Array()), show(Array()), show(new Vector()), show(Vector()), show(new picked()), show(picked()), show(made(Array)), show(made(picked)), show(calledFor(Array)), show(calledFor(Vector, 2)));
console.log(show(spread()), show(spread(2)), show(spread(undefined)), show(spread(1, 2)), show(Reflect.construct(Array, [])), show(Array.apply(null, [])), show(Array.call(null)), show(new Own()), show([Array, Vector].map(V => new V())));
for (let i = 0; i < 100; i++) { const list = made(i % 2 ? Array : picked); list.push(i); if (list.length !== 1 || list[0] !== i) console.log("wrong", i); }
