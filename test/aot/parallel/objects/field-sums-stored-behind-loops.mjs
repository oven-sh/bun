// STATISTIC: UnrolledLoopStoresSunk >= 20
// A loop that adds to a boxed field of its object keeps the sum in a register and stores it behind the loop.
const log = [];
class Base { constructor(n) { this.name = n; } get kind() { return "base"; } }
class Other extends Base { constructor(n) { super(n); this.other = 1; } get kind() { return "other"; } }
class Account extends Base { sum = 0; count = 0; constructor(n, xs) { super(n); for (const x of xs) { this.sum += x; this.count++; } } get kind() { return "account"; } }
class Assigned extends Base { constructor(n, xs) { super(n); this.sum = 0; this.list = xs; for (let i = 0; i < xs.length; i++) this.sum += xs[i]; } get kind() { return "assigned"; } }
class Breaks extends Base { sum = 0; last = 0; constructor(n, xs) { super(n); for (const x of xs) { if (x > 90) break; this.sum += x; this.last = this.sum; } } get kind() { return "breaks"; } }
class Reads extends Base { sum = 1; seen = 0; constructor(n, xs, o) { super(n); const p = o ?? this; for (const x of xs) { this.sum += x; this.seen += p.sum ?? 0; } } get kind() { return "reads"; } }
class Throws extends Base { sum = 0; constructor(n, xs, keep) { super(n); keep.push(this); for (const x of xs) this.sum += x; } get kind() { return "throws"; } }
class After extends Base { sum = 0; constructor(n, xs) { super(n); let i = 0; do { this.sum += xs[i] ?? 0; } while (++i < xs.length); } get kind() { return "after"; } }
class Nested extends Base { sum = 0; rows = 0; constructor(n, rows) { super(n); for (const row of rows) { for (const x of row) this.sum += x; this.rows++; } } get kind() { return "nested"; } }
const lists = [[], [1], [1, 2, 3], [0.5, 0.25], [-0], [2147483647, 1], [NaN, 1], [100, 1, 95, 2], Array.from({ length: 50 }, (_, i) => i), [1, , 3], ["a", 1], [1, "b"], [1n].slice(1), [undefined, 1], [null, 2], [true, 1]];
for (let k = 0; k < 40; k++) {
  for (const xs of lists) {
    const all = [new Account("a", xs), new Assigned("b", xs), new Breaks("c", xs), new Reads("d", xs), new Reads("e", xs, { sum: k }), new After("g", xs)];
    if (k % 13 === 0) log.push(all.map(o => Object.keys(o).map(key => Array.isArray(o[key]) ? "[]" : Object.is(o[key], -0) ? "-0" : String(o[key])).join(":")).join(" "));
  }
  const n = new Nested("h", [[1, 2], [], [k, 0.5]]);
  if (k % 13 === 0) log.push(n.sum, n.rows);
}
const kept = [];
for (const bad of [{ valueOf() { throw new Error("value " + kept[kept.length - 1].sum); } }, Symbol("s"), 1n, { valueOf() { return kept[kept.length - 1].sum; } }]) {
  try { const t = new Throws("f", [1, 2, bad, 4], kept); log.push(t.sum); } catch (e) { log.push(e.constructor.name, e.message.slice(0, 12), kept[kept.length - 1].sum); }
}
for (const C of [Account, Assigned, Throws]) log.push(Reflect.construct(C, ["q", [2, 3], kept], Other).sum, Reflect.construct(C, ["q", [], kept], Account).sum);
class Frozen extends Account { constructor(xs) { super("z", xs); Object.freeze(this); } add(xs) { for (const x of xs) this.sum += x; return this.sum; } }
const frozen = new Frozen([1, 2]);
for (const xs of [[], [1]]) { try { log.push(frozen.add(xs)); } catch (e) { log.push(e.constructor.name, frozen.sum); } }
class Watched extends Base { constructor(xs) { super("w"); let held = 5; const sets = []; Object.defineProperty(this, "sum", { get() { return held; }, set(v) { sets.push(v); held = v; }, enumerable: true }); for (const x of xs) this.sum += x; this.sets = sets.join(); } get kind() { return "watched"; } }
log.push(new Watched([1, 2]).sets, new Watched([]).sum);
console.log(log.join("\n"));
