// Classes that extend built-ins and hold private fields: who has them, what stores them, and what changes beside them.
const out = [];
function one(v) { return Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : Array.isArray(v) ? "[" + Array.from(v, one).join() + "]" : typeof v === "function" ? "f" : v && typeof v === "object" ? Object.prototype.toString.call(v) : String(v); }
function attempt(f) { try { return one(f()); } catch (e) { return e.constructor.name; } }
const bases = { Array, Map, Set, WeakMap, WeakSet, Error, RangeError, Float64Array, Uint8Array, Date, RegExp, ArrayBuffer, Promise, Object };
const given = { Array: [], Map: [], Set: [], WeakMap: [], WeakSet: [], Error: ["m"], RangeError: ["m"], Float64Array: [4], Uint8Array: [4], Date: [0], RegExp: ["a"], ArrayBuffer: [8], Promise: [(r) => r(1)], Object: [] };
class OfArray extends Array { #p = 1; #q = "q"; n = 2; next() { return this.#p++; } read() { return this.#q; } write(v) { this.#q = v; return this.#q; } loop(k) { let s = 0; for (let i = 0; i < k; i++) { this.n = i; this.#p += this.n; s += this.next(); } return s; } has(o) { return #p in o; } take(o) { return o.#q; } held() { let s = 0; for (let i = 0; i < this.length; i++) s += this[i] * this.#p; return s; } }
class OfMap extends Map { #p = 1; #q = "q"; n = 2; next() { return this.#p++; } read() { return this.#q; } write(v) { this.#q = v; return this.#q; } loop(k) { let s = 0; for (let i = 0; i < k; i++) { this.n = i; this.#p += this.n; s += this.next(); } return s; } has(o) { return #p in o; } take(o) { return o.#q; } held() { let s = 0; for (const [k, v] of this) s += v * this.#p; return s; } }
class OfSet extends Set { #limit; #hits = 0; constructor(limit) { super(); this.#limit = limit; } add(v) { if (this.size >= this.#limit) this.delete(this.values().next().value); this.#hits++; return super.add(v); } get hits() { return this.#hits; } get limit() { return this.#limit; } set limit(v) { this.#limit = v; } }
class OfError extends Error { #code; #seen = 0; constructor(m, code) { super(m); this.#code = code; } get code() { this.#seen++; return this.#code; } get seen() { return this.#seen; } again(k) { let s = 0; for (let i = 0; i < k; i++) s += this.code; return s; } }
class OfView extends Float64Array { #width; #stores = 0; constructor(w, h) { super(w * h); this.#width = w; this.height = h; } at2(x, y) { return this[y * this.#width + x]; } put2(x, y, v) { this.#stores++; this[y * this.#width + x] = v; } fill2() { for (let y = 0; y < this.height; y++) for (let x = 0; x < this.#width; x++) this.put2(x, y, x + y / 2); return this.#stores; } get stores() { return this.#stores; } }
class OfPromise extends Promise { #tag = "t"; #n = 0; tag() { this.#n += 0.5; return this.#tag + this.#n; } }
class Hidden extends Map { #p = 4; #twice(x) { return this.#p * x; } get #half() { return this.#p / 2; } set #half(v) { this.#p = v * 2; } static #made = 0; static made() { return ++Hidden.#made; } ask(x) { return this.#twice(x); } halved(v) { this.#half = v; return this.#half; } static is(o) { return #twice in o; } }
class Early extends Map { #a = this.read(); #b = 1; read() { try { return this.#b; } catch { return "early"; } } both() { return this.#a + "," + this.#b; } }
class Below extends OfMap { #p = 100; own() { return this.#p++; } both() { return [this.own(), this.next()]; } }
const several = (tag) => class extends Array { #p = tag; take(o) { return o.#p; } bump() { return this.#p += 1; } static has(o) { return #p in o; } };
class Borrower extends (function (o) { return o; }) { #b = 1; static b(o) { return o.#b++; } static has(o) { return #b in o; } }
function askAll(o, fresh, log) {
  for (let round = 0; round < 3; round++) log.push(o.next(), o.loop(5), o.read(), o.n, o.has(o), o.has({}), attempt(() => o.has(1)), attempt(() => o.take({})), attempt(() => o.take(fresh())), o.held());
  for (const v of [0.5, -0, NaN, "s", null, undefined, 2 ** 31, 7n, [1]]) log.push(one(o.write(v)), one(o.read()));
  o.extra = 1; log.push(o.next()); delete o.extra; log.push(o.next()); delete o.n; log.push(o.next(), one(o.n), o.loop(3));
  Object.defineProperty(o, "n", { value: 9, writable: false, configurable: true }); log.push(attempt(() => o.loop(2)), o.next());
  Object.defineProperty(o, "n", { get() { return 5; }, set(v) { this.kept = v; }, configurable: true }); log.push(attempt(() => o.loop(2)), o.next(), one(o.kept));
  Object.preventExtensions(o); log.push(o.next(), attempt(() => new Borrower(o))); Object.freeze(o); log.push(o.next(), o.write("frozen"), o.read());
  return log.map(one).join(" ");
}
for (let round = 0; round < 4; round++) {
  const a = new OfArray(); for (let i = 0; i < 6; i++) a.push(i + 0.5); out.push(askAll(a, () => new OfArray(), []));
  const m = new OfMap(); for (let i = 0; i < 6; i++) m.set(i, i); out.push(askAll(m, () => new OfMap(), []));
  const s = new OfSet(3); for (let i = 0; i < 20; i++) s.add(i & 7); out.push([...s].join() + s.hits + s.limit); s.limit = "x"; s.add(99); out.push([...s].join() + s.hits + s.limit);
  const e = new OfError("m", round + 0.5); out.push(e.again(7) + " " + e.seen + e.message + e.code);
  const v = new OfView(3, 4); out.push(v.fill2() + " " + v.at2(1, 2) + Array.from(v).join() + v.stores);
  const h = new Hidden(); out.push([h.ask(3), h.halved(5), h.ask(2), Hidden.made(), Hidden.is(h), Hidden.is({}), attempt(() => Hidden.prototype.ask.call({}, 1))].join());
  out.push(new Early().both()); const b = new Below(); out.push(one([b.both(), b.both(), b.loop(3), b.own(), b.take(new OfMap()), attempt(() => b.take(new OfArray()))]));
  const p = OfPromise.resolve(1); out.push(p.tag() + p.tag() + attempt(() => OfPromise.prototype.tag.call(Promise.resolve(1))));
  const A = several(1), B = several(2); const a1 = new A(), b1 = new B(); for (let i = 0; i < 4; i++) out.push(one([a1.bump(), b1.bump(), a1.take(a1), attempt(() => a1.take(b1)), A.has(b1), B.has(b1)]));
  for (const o of [new OfArray(), new OfMap(), v, e, h, new Map(), []]) { out.push(attempt(() => new Borrower(o)) + attempt(() => Borrower.b(o)) + attempt(() => Borrower.b(o)) + Borrower.has(o) + attempt(() => o.next()) + attempt(() => new Borrower(o))); }
}
for (const name in bases) {
  class Any extends bases[name] { #k = 1; #list = [name]; static is(o) { return #k in o; } k() { return this.#k++; } add(v) { this.#list.push(v); return this.#list.length; } get list() { return this.#list; } sum(n) { let s = 0; for (let i = 0; i < n; i++) s += this.k() + this.#list.length; return s; } }
  const x = new Any(...given[name]); for (let i = 0; i < 3; i++) out.push(name + x.k() + x.list.join() + x.sum(9) + Any.is(x) + Any.is(x.list) + attempt(() => Any.prototype.k.call(new bases[name](...given[name]))) + attempt(() => Any.prototype.k.call(new Proxy(x, {}))) + attempt(() => Any.prototype.k.call(Object.create(x))));
}
let total = 0; const counted = [new OfArray(), new OfMap(), new Below()]; for (let i = 0; i < 500; i++) for (const o of counted) total += o.next() + o.loop(2); out.push(total);
for (const l of out) console.log(l);
