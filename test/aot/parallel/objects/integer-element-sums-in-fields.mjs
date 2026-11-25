// STATISTIC: UnrolledLoopIntegerElementSums >= 4
// for (const x of xs) this.sum += x: the elements of an array of int32s are added as integers, whether the sum is a field or a variable. A hole, a fraction and a large sum leave that.
const log = [];
class Base { constructor(n) { this.name = n; } get kind() { return "base"; } }
class Other extends Base { constructor(n) { super(n); this.other = 1; } get kind() { return "other"; } }
class Account extends Base {
  sum = 0;
  count = 0;
  constructor(n, xs, start) { super(n); this.sum = start; for (const x of xs) { this.sum += x; this.count++; } }
  subtract(xs) { for (const x of xs) this.sum -= x; return this.sum; }
  byIndex(xs) { for (let i = 0; i < xs.length; i++) this.sum += xs[i]; return this.sum; }
  until(xs, most) { for (const x of xs) { if (x > most) break; this.sum += x; } return this.sum; }
  get kind() { return "account"; }
}
function sumOf(xs, start) { let sum = start; for (const x of xs) sum += x; return sum; }
function twice(xs) { let a = 0, b = 0; for (const x of xs) { a += x; b -= x; } return `${a} ${b}`; }
function show(v) { return Object.is(v, -0) ? "-0" : String(v); }
const full = n => Array.from({ length: n }, (_, i) => (i % 3 ? -i : i + 2));
const holed = (n, at) => { const xs = full(n); for (const i of at) delete xs[i]; return xs; };
const lists = [[], [1], full(7), full(8), full(9), full(64), full(1000), holed(40, [0]), holed(40, [7]), holed(40, [8, 9, 23]), holed(40, [39]), [...full(30), 0.5, ...full(10)], [...full(30), undefined, 1], [...full(20), null, 2], [...full(20), "x", 3], [...full(20), -0, 4], Array(40).fill(2147483647), Array(40).fill(-2147483648), [...full(16), 1n].slice(0, 16), [...full(25), NaN], [...full(25), Infinity, -Infinity], Array(24), new Array(24).fill(-0)];
for (let k = 0; k < 30; k++) {
  for (const start of [0, -0, 0.5, 9007199254740900, -9007199254740992, 1e300, NaN, k]) {
    for (const xs of lists) {
      const a = new Account("a", xs, start), b = new Other("b");
      const values = [a.sum, a.count, a.subtract(xs), a.byIndex(xs), a.until(xs, 20), sumOf(xs, start), twice(xs), b.other];
      if (k % 15 === 0) log.push(values.map(show).join(" "));
    }
  }
}
const kept = [];
for (const bad of [Symbol("s"), 1n, { valueOf() { return kept[0].sum; } }, { valueOf() { throw new Error("value"); } }]) {
  const a = new Account("c", full(10), 0);
  kept[0] = a;
  const xs = [...full(21), bad, 1];
  try { for (const x of [0]) a.byIndex(xs); log.push(a.sum); } catch (e) { log.push(e.constructor.name, a.sum); }
  try { a.subtract(xs); log.push(a.sum); } catch (e) { log.push(e.constructor.name, a.sum); }
}
const inherits = Object.setPrototypeOf(holed(40, [8, 9]), Object.create(Array.prototype, { 8: { value: 100 } }));
log.push(new Account("d", inherits, 0).sum, sumOf(inherits, 0), twice(inherits), new Account("f", full(3), 0).byIndex(inherits));
log.push(new Account("e", holed(40, [8, 9]), 0).sum, sumOf(holed(40, [8]), 0), Reflect.construct(Account, ["q", full(20), 1], Other).sum);
console.log(log.join("\n"));
