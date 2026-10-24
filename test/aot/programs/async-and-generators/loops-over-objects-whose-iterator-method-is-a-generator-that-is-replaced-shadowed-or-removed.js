// for-of over an object whose @@iterator is a generator method: every way that belief can end
const out = [];
function say(...a) { out.push(a.join(" ")); }
class Bag {
  constructor(...v) { this.v = v; }
  *[Symbol.iterator]() { for (let i = 0; i < this.v.length; i++) yield this.v[i]; }
}
class Twice extends Bag { *[Symbol.iterator]() { for (const x of this.v) { yield x; yield x; } } }
class Plain extends Bag { [Symbol.iterator]() { return this.v[Symbol.iterator](); } }
class Below extends Bag {}
function sum(b) { let s = 0; for (const x of b) s += x; return s; }
function first(b) { for (const x of b) return x; return -1; }
function spread(b) { return [...b].join(); }
function destructure(b) { const [p, q = "none"] = b; return p + ":" + q; }
function warm(b) { let s = 0; for (let i = 0; i < 300; i++) s += sum(b) + first(b); return s; }
const a = new Bag(1, 2, 3), t = new Twice(1, 2), p = new Plain(4, 5), w = new Below(6, 7);
say("warm", warm(a), warm(t), warm(p), warm(w), spread(a), spread(t), destructure(a), destructure(new Bag(1)));
// the order of events: the method is read, called, next is read once
const log = [];
const watched = new Proxy(a, { get(o, k, r) { log.push(String(k)); return Reflect.get(o, k, o); } });
say("proxy", sum(watched), log.join());
// an own @@iterator
const own = new Bag(1, 2, 3);
own[Symbol.iterator] = function* () { yield 50; };
say("own", sum(own), first(own), spread(own), sum(a));
delete own[Symbol.iterator];
say("own gone", sum(own));
// return() is called when the loop is left
class Closing { *[Symbol.iterator]() { try { yield 1; yield 2; } finally { say("finally ran"); } } }
say("left early", first(new Closing()));
try { for (const x of new Closing()) throw new Error("out"); } catch (e) { say("thrown out", e.message); }
outer: for (const x of new Closing()) { for (const y of new Closing()) continue outer; }
// the generators' own prototype gets a next | return
const mine = Bag.prototype[Symbol.iterator].prototype;
mine.next = function () { return { done: true }; };
say("next on the function's prototype", sum(a), sum(w), sum(t));
delete mine.next;
say("and gone", sum(a), sum(w));
mine.return = function (v) { say("my return"); return { done: true, value: v }; };
say("return on the function's prototype", first(a), first(t));
delete mine.return;
function attempt(name, f) { try { f(); say(name, "done"); } catch (e) { say(name, e.constructor.name); } }
// the method is replaced later
const old = Bag.prototype[Symbol.iterator];
Bag.prototype[Symbol.iterator] = function* () { yield 1000; };
say("replaced", sum(a), sum(w), sum(t), sum(p), first(a), spread(a), destructure(a));
Bag.prototype[Symbol.iterator] = function () { let n = 0; return { next() { return n++ < 2 ? { done: false, value: 7 } : { done: true } }, return() { say("object's return"); return {}; } }; };
say("replaced by a protocol object", sum(a), first(a), sum(w));
Bag.prototype[Symbol.iterator] = function () { return 5; };
attempt("gives a number", () => sum(a));
Bag.prototype[Symbol.iterator] = 5;
attempt("is a number", () => sum(a));
delete Bag.prototype[Symbol.iterator];
attempt("deleted", () => sum(a));
say("heirs with their own", sum(t), sum(p));
Object.defineProperty(Bag.prototype, Symbol.iterator, { get() { say("getter"); return old; }, configurable: true });
say("getter", sum(a), sum(w));
Object.defineProperty(Bag.prototype, Symbol.iterator, { value: old, writable: true, configurable: true });
say("restored", sum(a), sum(w), warm(a));
// the object's prototype moves
const moved = new Bag(1, 2, 3);
say("moved before", sum(moved));
Object.setPrototypeOf(moved, Twice.prototype); say("moved", sum(moved));
Object.setPrototypeOf(moved, Array.prototype); attempt("moved to Array.prototype", () => say(sum(moved)));
Object.setPrototypeOf(moved, null); attempt("moved to null", () => sum(moved));
// the list changes while it is walked; the generator throws; yields in a try
const growing = new Bag(1, 2); let n = 0; for (const x of growing) { if (n++ < 3) growing.v.push(x + 10); } say("growing", growing.v.join());
class Thrower { *[Symbol.iterator]() { yield 1; throw new RangeError("inside"); } }
attempt("throws inside", () => sum(new Thrower()));
class Args { *[Symbol.iterator]() { yield arguments.length; yield this === undefined; yield new.target === undefined; } }
say("arguments", spread(new Args()));
class Nested { constructor(k) { this.k = k; } *[Symbol.iterator]() { if (this.k > 0) { yield this.k; yield* new Nested(this.k - 1); } } }
say("nested", spread(new Nested(4)), sum(new Nested(10)));
say("uses", Array.from(a).join(), new Set(a).size, Math.max(...a), new Map([[1, a]]).get(1) === a, Object.fromEntries(new Bag(["k", 1]))["k"]);
Promise.all(new Bag(1, Promise.resolve(2))).then(v => { say("all", v.join()); console.log(out.join("\n")); });
