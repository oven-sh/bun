// STATISTIC: FieldSumsTakenForNumbers >= 1
// for (const x of this.list) this.#sum += x: the array is expected to hold numbers, as it is where the field is public.
const log = [];
class Base { constructor(n) { this.name = n; } get kind() { return "base"; } }
class Other extends Base { constructor(n) { super(n); this.other = 1; } get kind() { return "other"; } }
class Account extends Base {
  #sum = 0;
  #count = 0;
  list;
  constructor(n, xs) { super(n); this.list = xs; for (const x of this.list) { this.#sum += x; this.#count++; } }
  static peek(o) { return #sum in o ? o.#sum : "none"; }
  get kind() { return "account"; }
  get total() { return this.#sum; }
  get count() { return this.#count; }
}
class Late extends Base {
  #sum = "";
  constructor(n, xs) { super(n); this.list = xs; for (const x of this.list) this.#sum += x; }
  get total() { return this.#sum; }
}
const lists = [[], [1], [0.5, 0.25], Array.from({ length: 40 }, (_, i) => i), Array.from({ length: 40 }, (_, i) => i / 4), [1, , 3], ["a", 1], [1, "b"], [undefined, 1], [null, 2], [-0], [NaN, 1], [2147483647, 1], new Set([1, 2]), "123", new Float32Array([1.5, 2]), { *[Symbol.iterator]() { yield 1; yield 2.5; } }, [{ valueOf() { return 7; } }]];
for (let k = 0; k < 40; k++) {
  for (const xs of lists) {
    const a = new Account("a", xs), l = new Late("l", xs), o = new Other("o");
    if (k % 13 === 0) log.push([a.total, a.count, l.total, Account.peek(o), Account.peek(a)].map(v => Object.is(v, -0) ? "-0" : String(v)).join(" "));
  }
}
for (const bad of [Symbol("s"), 1n, { valueOf() { throw new Error("value"); } }]) {
  try { log.push(new Account("b", [1, 2, bad]).total); } catch (e) { log.push(e.constructor.name); }
}
log.push(Account.peek(Reflect.construct(Account, ["q", [2, 3]], Other)));
console.log(log.join("\n"));
