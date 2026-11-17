const attempt = f => { try { return f(); } catch (e) { return `${e.name}: ${e.message}`.slice(0, 60); } };
class List { constructor(items) { this.items = items; } [Symbol.iterator]() { return this.items[Symbol.iterator](); } }
class Values { constructor(items) { this.items = items; } [Symbol.iterator]() { return this.items.values(); } }
class Keys { constructor(items) { this.items = items; } [Symbol.iterator]() { return this.items.keys(); } }
class Entries { constructor(items) { this.items = items; } [Symbol.iterator]() { return this.items.entries(); } }
class OfMap { #map = new Map(); set(k, v) { this.#map.set(k, v); return this; } delete(k) { return this.#map.delete(k); } [Symbol.iterator]() { return this.#map.values(); } }
class OfEntries { map = new Map(); [Symbol.iterator]() { return this.map[Symbol.iterator](); } }
class OfSet { set = new Set(); add(v) { this.set.add(v); return this; } [Symbol.iterator]() { return this.set.values(); } }
class Deep { inner = { list: [1, 2, 3] }; [Symbol.iterator]() { return this.inner.list[Symbol.iterator](); } }
class Counted { items = [1, 2]; opened = 0; [Symbol.iterator]() { this.opened++; return this.items.values(); } }
class Stepped { items = [1, 2, 3]; [Symbol.iterator]() { const it = this.items.values(); it.next(); return it; } }
class Either { constructor(k) { this.k = k; } [Symbol.iterator]() { if (this.k) return [7, 8].values(); return new Set([9]).values(); } }
class Text { text = "añ😀"; [Symbol.iterator]() { return this.text[Symbol.iterator](); } }
class Typed { items = new Uint8Array([4, 5]); [Symbol.iterator]() { return this.items.values(); } }
class Bad { [Symbol.iterator]() { return this.nothing.values(); } }
class NoObject { x = 1; [Symbol.iterator]() { return Math.abs(this.x); } }
function total(o) { let t = 0; for (const x of o) t += typeof x === "number" ? x : Array.isArray(x) ? x[0] * 10 + (x[1] ?? 0) : String(x).length; return t; }
const turns = (name, o, f = total) => { let s = 0; for (let i = 0; i < 120; i++) s = (s * 3 + f(o)) | 0; console.log(name, s); };
turns("list", new List([1, 2, 3])); turns("empty", new List([])); turns("doubles", new List([1.5, 2.5])); turns("holes", new List([1, , 3])); turns("objects", new List(["a", {}, null]));
turns("values", new Values([1, 2, 3])); turns("keys", new Keys([5, 5, 5])); turns("entries", new Entries([5, 6])); turns("keys of map", new Keys(new Map([[1, 2], [3, 4]]))); turns("entries of map", new Entries(new Map([[1, 2], [3, 4]]))); turns("values of set", new Values(new Set([1, 2]))); turns("typed", new Values(new Float32Array([1.5, 2])));
turns("of map", new OfMap().set("a", 1).set("b", 2)); const pairs = new OfEntries(); pairs.map.set(1, 2).set(3, 4); turns("of entries", pairs); turns("of set", new OfSet().add(1).add(5)); turns("deep", new Deep()); const counted = new Counted(); turns("counted", counted); console.log(counted.opened); turns("stepped", new Stepped()); turns("either", new Either(1)); turns("or", new Either(0)); turns("text", new Text()); turns("view", new Typed());
for (let i = 0; i < 3; i++) console.log(attempt(() => total(new Bad())), attempt(() => total(new NoObject())), attempt(() => total(new List(undefined))), attempt(() => total(new List({ [Symbol.iterator]() { return { next() { return { done: true }; } }; } }))), attempt(() => total(new Values(5))), attempt(() => total(null)));
function pattern(o) { const [a, b, ...rest] = o; return a * 100 + (b ?? 0) * 10 + rest.length; }
turns("pattern", new List([1, 2, 3, 4]), pattern); turns("pattern of map", new OfMap().set(1, 3).set(2, 4), pattern);
function spread(o) { return [...o].length + Math.max(...o) + Array.from(o).length; }
turns("spread", new List([1, 2, 3]), spread); turns("spread of set", new OfSet().add(4).add(2), spread);
function changing(o, list) { let t = 0; for (const x of o) { t += x; if (t < 50 && list.length < 8) list.push(x + 1); if (x === 3) list.length = 2; } return t; }
{ let s = 0; for (let i = 0; i < 50; i++) { const items = [1, 2]; s += changing(new List(items), items) * 10 + items.length; } console.log("changing", s); }
function deleting(m) { let t = 0; for (const x of m) { t += x; if (x === 2) { m.delete("a"); m.set("z", 9); } if (x === 9) m.delete("z"); } return t; }
{ let s = 0; for (let i = 0; i < 50; i++) s += deleting(new OfMap().set("a", 1).set("b", 2).set("c", 3)); console.log("deleting", s); }
function leaves(o) { for (const x of o) { if (x > 1) return x; } return 0; }
function breaks(o) { let t = 0; for (const x of o) { if (x > 2) break; t += x; } return t; }
function throws(o) { try { for (const x of o) if (x > 1) throw new RangeError("x"); } catch (e) { return e.name.length; } return 0; }
function nested(a, b) { let t = 0; outer: for (const x of a) for (const y of b) { if (y > 2) continue outer; t += x * y; } return t; }
{ const a = new List([1, 2, 3]), b = new OfMap().set(1, 1).set(2, 2).set(3, 3); let s = 0; for (let i = 0; i < 80; i++) s += leaves(a) + breaks(b) + throws(a) + nested(a, b) + nested(b, a); console.log("exits", s); }
function* delegating(o) { yield* o; } console.log([...delegating(new List([1, 2]))].join(), [...delegating(new OfMap().set(1, 2))].join());
async function awaited(o) { let t = 0; for await (const x of o) t += await x; return t; } console.log(await awaited(new List([1, Promise.resolve(2)])), await awaited(new OfSet().add(3)));
const own = new List([1, 2]); own[Symbol.iterator] = function* () { yield 100; }; turns("own", own);
const proxied = new Proxy(new List([1, 2]), {}); turns("proxy", proxied);
const listWithOwn = [1, 2]; listWithOwn[Symbol.iterator] = function* () { yield 50; }; turns("list with own", new List(listWithOwn)); turns("values of it", new Values(listWithOwn));
class Sub extends Array { *[Symbol.iterator]() { yield 60; } values() { return [70][Symbol.iterator](); } } turns("sub", new List(Sub.from([1]))); turns("sub values", new Values(Sub.from([1])));
class SubMap extends Map { values() { return [80].values(); } } turns("sub map", new Values(new SubMap([[1, 2]])));
List.prototype[Symbol.iterator] = function () { return [this.items.length].values(); }; turns("replaced", new List([1, 2, 3]));
