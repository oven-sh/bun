// Array.from with a function over maps, sets, their iterators and others.
const all = process.argv[2] === "all"; let lines = 0, hash = 0, log = "";
function say(line) { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line.slice(0, 240)); else if (lines % 23 === 0) console.log(lines, hash); }
function show(x) { return Object.is(x, -0) ? "-0" : Array.isArray(x) ? x.constructor.name + "[" + Array.from({ length: x.length }, (_, i) => i in x ? show(x[i]) : "hole").join() + "]" : typeof x === "object" && x ? x.constructor?.name + "{" + Object.keys(x).map(k => k + ":" + show(x[k])).join() + "}" : typeof x === "symbol" ? "symbol" : String(x); }
class OwnSet extends Set { *[Symbol.iterator]() { log += "i"; yield* super.values(); yield "own"; } }
class OwnMap extends Map { entries() { log += "e"; return super.entries(); } }
class List extends Array { constructor(...a) { super(...a); log += "C" + a.length; } }
class Odd { constructor(n) { log += "O" + n; } set length(n) { log += "L" + n; } get length() { return 3; } }
class Closed { constructor() { Object.freeze(this); } }
class Picky { constructor() { Object.defineProperty(this, 1, { value: "kept", writable: false, configurable: false }); } }
function Plain() { if (new.target) this.made = true; }
const seed = [[0, "zero"], [1, 1.5], ["a", null], [NaN, -0], [null, [1]], [undefined, "u"]];
let current;
const numbers = () => current = new Set([3, 1, 2, 1, 7]), mixed = () => current = new Set([1, "a", null, undefined, NaN, -0, 2.5, true]), map = () => current = new Map(seed);
const stepped = (it, n) => { while (n--) it.next(); return it; }, withOwn = (it, o) => Object.assign(it, o);
const items = {
  numbers, mixed, map, none: () => current = new Set(), noEntries: () => current = new Map(), many: () => current = new Set(Array.from({ length: 70 }, (_, i) => i * 3)), holes: () => { const s = numbers(); s.delete(1); s.delete(3); s.add(9); return s; }, ownSet: () => current = new OwnSet([1, 2]), ownMap: () => current = new OwnMap(seed),
  keys: () => map().keys(), values: () => map().values(), entries: () => map().entries(), setValues: () => numbers().values(), setEntries: () => numbers().entries(), afterOne: () => stepped(map().keys(), 1), afterAll: () => stepped(numbers().values(), 9), afterTwoPairs: () => stepped(map().entries(), 2),
  ownNext: () => withOwn(map().values(), { n: 0, next() { log += "n"; return { done: this.n > 2, value: this.n++ }; } }), ownReturn: () => withOwn(map().values(), { return() { log += "R"; return {}; } }), badReturn: () => withOwn(numbers().values(), { return() { log += "B"; return 5; } }), throwingReturn: () => withOwn(map().keys(), { return() { throw new RangeError("return"); } }), ownIterator: () => withOwn(numbers().values(), { [Symbol.iterator]() { log += "o"; return map().keys(); } }), otherNext: () => withOwn(numbers().values(), { next: map().keys().next }), borrowedNext: () => ({ [Symbol.iterator]: () => ({ next: new Set([1]).values().next }) }), setNext: () => { const it = numbers().values(); return { [Symbol.iterator]: () => ({ next: () => it.next(), return() { log += "r"; return {}; } }) }; }, protoIterator: () => ({ [Symbol.iterator]: () => Object.create(numbers().values()) }),
  list: () => [1, , "x"], listValues: () => ["p", "q", 3].values(), listEntries: () => ["p", "q"].entries(), listKeys: () => [5, 6, 7].keys(), text: () => "a日b", generator: () => (function* () { try { yield 1; yield 2; yield 3; } finally { log += "f"; } })(), arrayLike: () => ({ length: 3, 0: "x", 2: "z" }), weird: () => ({ [Symbol.iterator]: 5 }), nothing: () => null, number: () => 7, search: () => new URLSearchParams("a=1&b=2"), view: () => new Float32Array([1.5, NaN]), args: () => (function () { return arguments; })(1, "b"), proxy: () => new Proxy(new Set([1]), {}), mapIterator: () => ({ [Symbol.iterator]: () => map().values() }),
};
const functions = {
  none: undefined, twice: x => x + x, index: (x, i) => i, pair: (x, i) => [x, i], count: function () { return arguments.length; }, that: function (x) { return this === undefined ? "strict" : typeof this === "object" ? "object" : typeof this; }, marked: function (x) { return this?.mark ?? "no"; }, second: p => p?.[1], parts: ([a, b] = []) => a + "/" + b, object: (x, i) => ({ x, i }), undef: () => {}, doubles: (x, i) => i + 0.5,
  deleting: x => { current?.delete?.(x); current?.delete?.(2); return x; }, adding: (x, i) => { if (i < 3) current instanceof Map ? current.set("n" + i, i) : current?.add?.("n" + i); return x; }, clearing: (x, i) => { if (i === 1) current?.clear?.(); return x; }, refilled: (x, i) => { if (i === 1) { current?.clear?.(); current instanceof Map ? current.set("r", 1) : current?.add?.("r"); } return x; }, throwing: (x, i) => { if (i === 1) throw new Error("at " + String(i)); return x; }, throwingFirst: () => { throw "first"; }, notCallable: 5, string: "f", proxy: new Proxy(x => [x], { apply(t, self, a) { log += "P" + a.length; return Reflect.apply(t, self, a); } }), bound: function (x) { return [this.mark, x]; }.bind({ mark: "B" }), builtin: String, parse: parseInt, symbol: () => Symbol.iterator, klass: class {},
};
const makers = { Array, List, Odd, Closed, Picky, Plain, undefined, arrow: () => 1, object: { mark: 1 } };
const thats = { none: [], object: [{ mark: "M" }], number: [5], undef: [undefined] };
for (let turn = 0; turn < 2; turn++) for (const i of Object.keys(items)) for (const f of Object.keys(functions)) for (const m of Object.keys(makers)) for (const t of Object.keys(thats)) {
  if ((m !== "Array" && t !== "none") || (t !== "none" && f === "none")) continue;
  log = ""; let r; try { r = show(Array.from.call(makers[m], items[i](), functions[f], ...thats[t])); } catch (e) { r = "! " + (e?.constructor?.name ?? "") + " " + (e?.message ?? String(e)); }
  say([i, f, m, t, r, log].join(" "));
}
for (const i of Object.keys(items)) for (const f of Object.keys(functions)) { log = ""; let r; try { r = show(Array.from(items[i](), functions[f])); } catch (e) { r = "! " + (e?.constructor?.name ?? "") + " " + (e?.message ?? String(e)); } say(["plain", i, f, r, log].join(" ")); }
console.log("lines", lines, hash);
