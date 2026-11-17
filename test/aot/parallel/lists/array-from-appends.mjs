// Array.from() over iterators appends in place: results of its own, of a subclass and of any constructor, with mappers that throw, and sources that change while they are read.
const text = v => typeof v === "string" ? JSON.stringify(v) : Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.length + ":" + Array.from({ length: v.length }, (_, i) => i in v ? text(v[i]) : "hole").join() + "]" : typeof v === "object" && v ? "o" + Object.keys(v).join() : String(v);
let closed = 0;
class Closing { constructor(n) { this.n = n; this.i = 0; } [Symbol.iterator]() { return this; } next() { return this.i < this.n ? { value: this.i++ * 1.5, done: false } : { value: undefined, done: true }; } return() { closed++; return {}; } }
class Sub extends Array { }
function Own(n) { this.given = n; }
class Full extends Array { constructor() { super(); this.push(7, 8, 9, 10, 11, 12, 13, 14, 15, 16); } }
function Frozen() { return Object.freeze([1, 2, 3]); }
function ReadOnly() { const a = [1, 2, 3]; Object.defineProperty(a, 1, { writable: false, configurable: false }); return a; }
function* numbers(n) { try { for (let i = 0; i < n; i++) yield i & 1 ? i : i * 0.5; } finally { closed++; } }
const set = new Set([1, 2.5, "c", undefined, null, -0, { a: 1 }]), map = new Map([[1, 2], ["k", { v: 1 }], [NaN, -0]]), list = [1, , 3.5, "x"], many = new Set(Array.from({ length: 70 }, (_, i) => i));
const sources = { set: () => set, map: () => map, keys: () => map.keys(), values: () => map.values(), entries: () => map.entries(), setValues: () => set.values(), list: () => list, listValues: () => list.values(), listEntries: () => list.entries(), many: () => many, manyValues: () => many.values(), generator: () => numbers(6), closing: () => new Closing(5), string: () => "añ😀z", like: () => ({ length: 3, 0: "a", 2: "c" }), empty: () => new Set() };
const mappers = { none: undefined, same: x => x, index: (x, i) => i, number: x => typeof x === "number" ? x * 2 : 0.5, boxed: (x, i) => i % 3 === 2 ? "t" : i, object: x => ({ x }), throwing: (x, i) => { if (i === 2) throw new RangeError("third"); return i; }, dropping: (x, i) => { if (i === 1) set.delete(2.5), set.add(2.5); return x; } };
const thisArg = { base: 10 };
for (let turn = 0; turn < 3; turn++) {
  for (const s in sources) for (const m in mappers) {
    closed = 0;
    let said; try { said = text(mappers[m] ? Array.from(sources[s](), mappers[m]) : Array.from(sources[s]())); } catch (e) { said = "threw " + e.constructor.name + " " + e.message; }
    console.log(s, m, said, closed);
  }
  for (const s in sources) {
    closed = 0;
    let said; try { said = text(Array.from(sources[s](), function (x, i) { return this.base + i; }, thisArg)); } catch (e) { said = "threw " + e.message; }
    console.log(s, "with this", said, closed);
  }
  for (const C of [Sub, Own, Full, Frozen, ReadOnly]) for (const s of ["set", "values", "listValues", "generator", "closing", "many"]) for (const mapper of [undefined, x => x, (x, i) => i * 2]) {
    closed = 0;
    let said; try { const made = Array.from.call(C, sources[s](), mapper); said = text(made) + " " + made.length + " " + made.constructor.name + " " + Object.keys(made).length; } catch (e) { said = "threw " + e.constructor.name; }
    console.log(C.name, s, said, closed);
  }
}
