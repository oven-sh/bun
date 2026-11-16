// Stores into fields that are filled need no order of keys: fields of heirs are summed over lists behind other stores and reads.
// STATISTIC: KeyOrderChecksOfFilledSlotsRemoved >= 3
// STATISTIC: SlotsCarriedAroundLoops >= 5
const said = [];
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v));
class Base { constructor(n) { this.name = n; } get kind() { return "base"; } }
class Other extends Base { constructor(n) { super(n); this.other = 1; } get kind() { return "other"; } }
class Third extends Base { constructor(n) { super(n); this.third = [n]; } get kind() { return "third"; } }
class Account extends Base { sum = 0; list; constructor(n, xs) { super(n); this.list = xs; for (const x of this.list) this.sum += x; } get kind() { return "account"; } }
class Two extends Base { sum = 0; count = 0; constructor(n, xs) { super(n); this.list = xs; for (const x of xs) { this.sum += x; this.count++; } } get kind() { return "two"; } }
class Mean extends Base { constructor(n, xs) { super(n); this.sum = 0; this.seen = 0; if (xs.length > 2) this.long = true; for (let i = 0; i < xs.length; i++) { this.sum += xs[i]; this.seen = this.seen + 1; } this.mean = this.sum / this.seen; } get kind() { return "mean"; } }
class Between extends Base { sum = 0; constructor(n, xs) { super(n); if (n === "frozen") Object.freeze(this); if (n === "sealed") Object.preventExtensions(this); if (n === "deleted") delete this.sum; if (n === "got") Object.defineProperty(this, "sum", { get() { return 3; }, set(v) { said.push("set " + v); }, configurable: true }); for (const x of xs) this.sum += x; this.after = 1; } get kind() { return "between"; } }
const lists = [[1, 2, 3], [0.5, 1.25, -3], [1, 2.5, "t", 4], [2 ** 31 - 1, 5], [], [1, , 3], [undefined, 1], [-0], [{ valueOf() { return 7; } }, 1], [1n], Object.freeze([4, 5]), [NaN, 1]];
const attempt = f => { try { said.push(show(f())); } catch (error) { said.push(error.constructor.name); } };
for (let turn = 0; turn < 30; turn++) {
  for (const xs of lists) {
    attempt(() => new Account("a", xs)); attempt(() => new Two("t", xs)); attempt(() => new Mean("m", xs));
    attempt(() => new Between(["plain", "frozen", "sealed", "deleted", "got"][turn % 5], xs));
  }
  if (said.length > 700) said.length = 400;
}
const doubles = Array.from({ length: 200 }, (_, i) => (i % 2 ? -i * 0.5 : i + 3.25)), ints = Array.from({ length: 200 }, (_, i) => (i % 2 ? -i : i + 3));
let total = 0;
for (let turn = 0; turn < 40; turn++) { total += new Account(turn % 2 ? "a" : "b", turn % 3 ? doubles : ints).sum + new Two("c", ints).count + new Two("c", doubles).sum + new Mean("d", doubles).mean; }
attempt(() => Reflect.construct(Account, ["r", [2, 3]], Other)); attempt(() => Reflect.construct(Two, ["r", [2, 3]], Third).kind); attempt(() => Object.keys(new Mean("k", [1, 2, 3])).join()); attempt(() => Object.keys(new Two("k", [1])).join());
Object.defineProperty(Base.prototype, "sum", { set(v) { said.push("base " + v); }, get() { return 1; }, configurable: true });
attempt(() => new Mean("late", [1, 2])); attempt(() => new Account("late", [1, 2]));
const all = [new Base("x"), new Other("y"), new Third("z")]; let kinds = ""; for (const o of all) kinds += o.kind + o.name;
let hash = 0; for (const s of said) for (const c of s) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, said.length, total, kinds); console.log(said.slice(0, 60).join("\n")); console.log(said.slice(-8).join("\n"));
