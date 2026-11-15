// Public fields of heirs are summed over lists that nobody knows: the sum stays in a register, and the list is read as numbers.
// STATISTIC: FieldSumsTakenForNumbers >= 3
// STATISTIC: SlotsCarriedAroundLoops >= 5
const said = [];
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v));
class Base { constructor(n) { this.name = n; } get kind() { return "base"; } }
class Other extends Base { constructor(n) { super(n); this.other = 1; } get kind() { return "other"; } }
class Third extends Base { constructor(n) { super(n); this.third = [n]; } get kind() { return "third"; } }
class Account extends Base { sum = 0; list; constructor(n, xs) { super(n); this.list = xs; for (const x of this.list) this.sum += x; } get kind() { return "account"; } }
class Counted extends Base { sum = 0; seen = 0; list; constructor(n, xs) { super(n); this.list = xs; for (const x of this.list) { this.sum += x; this.seen++; } } get kind() { return "counted"; } }
class Indexed extends Base { total = 0.5; list; constructor(n, xs) { super(n); this.list = xs; for (let i = 0; i < this.list.length; i++) this.total += xs[i]; } get kind() { return "indexed"; } }
class Down extends Base { left = 100; list; constructor(n, xs) { super(n); this.list = xs; for (const x of this.list) this.left -= x; } get kind() { return "down"; } }
class Text extends Base { all = ""; list; constructor(n, xs) { super(n); this.list = xs; for (const x of this.list) this.all += x; } get kind() { return "text"; } }
class Watched extends Base { sum = 0; list; constructor(n, xs) { super(n); this.list = xs; if (n === "frozen") Object.freeze(this); if (n === "deleted") delete this.sum; if (n === "got") Object.defineProperty(this, "sum", { get() { return 2; }, set(v) { said.push("set " + v); }, configurable: true }); for (const x of this.list) this.sum += x; } get kind() { return "watched"; } }
const lists = [[1, 2, 3], [0.5, 1.25, -3], [1, 2.5, "t", 4], [2 ** 31 - 1, 5], [2 ** 53, 1, 1], [], [1, , 3], [undefined, 1], [-0], [null, 2], [{ valueOf() { said.push("valueOf"); return 7; } }, 1], [1n], Object.freeze([4, 5.5]), [NaN, 1], new Set([1, 2]), new Float64Array([1.5, 2]), "123", { [Symbol.iterator]: function* () { yield 1; yield 2; } }, { length: 2, 0: 1, 1: 2 }];
const attempt = f => { try { said.push(show(f())); } catch (error) { said.push(error.constructor.name); } };
const kinds = [Account, Counted, Indexed, Down, Text];
for (let turn = 0; turn < 20; turn++) {
  for (const xs of lists) {
    for (const K of kinds) attempt(() => { const a = new K("n" + turn, xs); delete a.list; return a; });
    attempt(() => { const a = new Watched(["plain", "frozen", "deleted", "got"][turn % 4], xs); return [a.sum, a.kind]; });
  }
  if (said.length > 900) said.length = 500;
}
const doubles = Array.from({ length: 300 }, (_, i) => (i % 2 ? -i * 0.5 : i + 3.25)), ints = Array.from({ length: 300 }, (_, i) => (i % 2 ? -i : i + 3));
let total = 0;
for (let turn = 0; turn < 60; turn++) { const xs = turn % 3 ? doubles : ints; total += new Account(turn % 2 ? "a" : "b", xs).sum + new Counted("c", xs).seen + new Indexed("i", xs).total + new Down("d", xs).left; }
attempt(() => Reflect.construct(Account, ["r", [2, 3]], Other).sum); attempt(() => Reflect.construct(Counted, ["r", [2.5, 3]], Third).kind);
class Growing extends Base { sum = 0; constructor(n, xs) { super(n); let k = 0; for (const x of xs) { this.sum += x; if (k++ < 3) xs.push(k); } } }
attempt(() => new Growing("g", [1, 2]).sum); attempt(() => new Growing("g", [0.5]).sum);
Object.defineProperty(Base.prototype, "sum", { set(v) { said.push("base " + v); }, get() { return 1; }, configurable: true });
attempt(() => new Account("late", [1, 2]).sum); attempt(() => new Watched("deleted", [1, 2]).sum);
let names = ""; for (const o of [new Base("x"), new Other("y"), new Third("z")]) names += o.kind + o.name;
let hash = 0; for (const s of said) for (const c of s) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, said.length, total, names); console.log(said.slice(0, 120).join("\n")); console.log(said.slice(-9).join("\n"));
