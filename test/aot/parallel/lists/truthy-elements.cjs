// filter(Boolean) over every kind of storage, holes, accessors, heirs, proxies; Boolean under other names; results that are written to.
"use strict";
const out = [];
const text = list => list.length + "[" + Array.from({ length: list.length }, (_, i) => i in list ? Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] ? "{}" : typeof list[i] + " " + String(list[i]) : "hole").join(",") + "]";
const show = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + e.message; } out.push(name + " " + (Array.isArray(r) ? text(r) : String(r))); };
function truthy(list) { return list.filter(Boolean); }
function inLoop(list, n) { let r; for (let i = 0; i < n; i++) r = list.filter(Boolean); return r; }
const B = Boolean; function aliased(list) { return list.filter(B); } function withThis(list) { return list.filter(Boolean, { x: 1 }); }
const accessor = [1, 0, 2, 3]; Object.defineProperty(accessor, 1, { get() { return "got"; }, configurable: true });
const shrinking = () => { const l = [1, 2, 3, 4, 5]; Object.defineProperty(l, 1, { get() { l.length = 3; return 7; }, configurable: true }); return l; };
const growing = () => { const l = [0.5, 1.5, , 2.5]; Object.defineProperty(l, 2, { get() { l.push("x"); l[3] = "y"; return 1; }, configurable: true }); return l; };
class List extends Array { } class Species extends Array { static get [Symbol.species]() { return Array; } }
const makers = { empty: () => [], ints: () => [0, 1, -1, 2, 0, 3], doubles: () => [0.5, 0, -0, NaN, 1.5, Infinity, -0.5], nan: () => [NaN, 0, NaN], mixed: () => [0, "", "a", null, undefined, false, true, NaN, {}, [], 0n, 1n, Symbol.iterator], holes: () => [1, , 0, , 2], holesOfDoubles: () => [0.5, , 0, , 1.5], made: () => new Array(5), texts: () => ["", "a", "", "b"], long: () => Array.from({ length: 100 }, (_, i) => i % 3), longDoubles: () => Array.from({ length: 100 }, (_, i) => (i % 3) * 0.5), sparse: () => { const l = [1]; l[2000] = 2; return l; }, accessor: () => accessor, shrinking, growing, frozen: () => Object.freeze([0, 1, 2]), list: () => List.from([0, 1, 2]), species: () => Species.from([0, 1, 2]), proxy: () => new Proxy([0, 1, 2], {}), object: () => ({ length: 3, 0: 0, 1: 1, 2: 2, filter: Array.prototype.filter }), words: () => "a  b c".split(" "), view: () => new Uint8Array([0, 1, 2]) };
for (const name of Object.keys(makers)) { show(name, () => truthy(makers[name]())); show(name + " in a loop", () => inLoop(makers[name](), 3)); show(name + " aliased", () => aliased(makers[name]())); show(name + " with this", () => withThis(makers[name]())); show(name + " kind", () => { const r = truthy(makers[name]()); return r.constructor.name + Array.isArray(r); }); }
show("written to", () => { const a = [1, 0, 2], r = truthy(a); r.push(0.5); r[0] = "x"; a[0] = 9; return text(a) + text(r); });
show("chained", () => ["a", "", "b", null].filter(Boolean).map(s => s.toUpperCase()).join("-") + [0, 1, 2].map(x => x - 1).filter(Boolean).length);
show("nothing", () => truthy(null)); show("other", () => truthy({ length: 1, 0: 1, filter: Array.prototype.filter }).length);
const run = n => { let s = 0; const lists = [[0, 1, 2, 3], [0.5, 0, 1.5], ["", "a"], [1, , 0]]; for (let i = 0; i < n; i++) s += truthy(lists[i & 3]).length; return s; }; show("run", () => run(400));
for (const line of out) console.log(line);
