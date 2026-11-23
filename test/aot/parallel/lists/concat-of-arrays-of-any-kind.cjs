// concat() of one value on receivers nobody knows: every pair of kinds of storage, holes, species, isConcatSpreadable, copies that are written to.
"use strict";
const out = [];
const text = list => Array.isArray(list) ? list.length + "[" + Array.from({ length: Math.min(list.length, 40) }, (_, i) => i in list ? Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" && list[i] ? "{}" : typeof list[i] === "function" ? "function" : typeof list[i] + " " + String(list[i]) : "hole").join(",") + "]" : typeof list === "string" ? "text " + list : String(list);
const show = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + e.message; } out.push(name + " " + text(r)); };
function join(a, b) { return a.concat(b); }
function joinTwo(a, b, c) { return a.concat(b, c); }
const frozen = Object.freeze([1, 2]), cow = () => [1, 2, 3], words = "a b c d e f g h i j".split(" ");
class List extends Array { } class Species extends Array { static get [Symbol.species]() { return Array; } } class Own extends Array { concat(x) { return "own " + x.length; } }
const spread = { length: 2, 0: "x", 1: "y", [Symbol.isConcatSpreadable]: true }, closed = [7, 8]; closed[Symbol.isConcatSpreadable] = false;
const named = [1]; named.name = 1; const grown = [1]; for (let i = 0; i < 20; i++) grown.push(i); const shifted = [1, 2, 3, 4]; shifted.shift();
const doubled = [1, 2]; doubled.push(0.5); const boxed = [0.5]; boxed.push("x"); const sparse = []; sparse[5000] = 1; const long = Array.from({ length: 300 }, (_, i) => i), longDoubles = long.map(v => v + 0.5);
const accessor = [1, 2]; Object.defineProperty(accessor, 1, { get() { return "got"; }, configurable: true });
const makers = { empty: () => [], ints: () => [1, -2, 3], cow, doubles: () => [0.5, -0, 1e300], nan: () => [NaN, 0.5], wide: () => [2 ** 31, 2 ** 53], texts: () => ["a", "b"], mixed: () => [1, "a", null, undefined, {}, true, 0.5], holes: () => [1, , 3], holesOfDoubles: () => [0.5, , 1.5], holesOfTexts: () => ["a", , "b"], made: () => new Array(3), filled: () => new Array(3).fill(0), nested: () => [[1], [2]], undefineds: () => [undefined, undefined], bigints: () => [1n],
  frozen: () => frozen, words: () => words, named: () => named, grown: () => grown, shifted: () => shifted, doubled: () => doubled, boxed: () => boxed, sparse: () => sparse, long: () => long, longDoubles: () => longDoubles, accessor: () => accessor, closed: () => closed, spread: () => spread, list: () => List.from([1, 2]), species: () => Species.from([1, 2]), own: () => Own.from([1]), text: () => "text", number: () => 5, object: () => ({ length: 1, 0: "z" }), nothing: () => null, view: () => new Uint8Array([1, 2]), proxy: () => new Proxy([1, 2], {}), symbol: () => Symbol.iterator, f: () => function f() {} };
for (const a of Object.keys(makers)) for (const b of Object.keys(makers)) show(a + " " + b, () => join(makers[a](), makers[b]()));
for (const a of ["ints", "doubles", "texts", "holes", "empty", "list"]) for (const b of ["empty", "doubles", "mixed", "holes", "number"]) show("two " + a + " " + b, () => joinTwo(makers[a](), makers[b](), makers[a]()));
show("not shared", () => { const a = cow(), b = cow(), c = join(a, b); c[0] = 9; c.push(0.5); a[1] = "x"; return [a, b, c].map(text).join(); });
show("from empty", () => { const a = [], b = [1, 2], c = join(a, b), d = join(b, a); c.push(3); d[0] = "x"; return [a, b, c, d].map(text).join(); });
show("stays plain", () => { const c = join([1], [2]); c.name = 1; return Object.keys(c).join() + (Object.getPrototypeOf(c) === Array.prototype) + c.constructor.name; });
show("collected", () => { let t = []; for (let i = 0; i < 400; i++) { t = join(t.length > 30 ? [] : t, [{ i }, "t" + i]); if (i % 150 === 149 && typeof Bun === "object") Bun.gc(true); } return t.map(x => typeof x === "object" ? x.i : x); });
const run = (n) => { let s = 0; for (let i = 0; i < n; i++) { const r = join(i & 1 ? [i] : [0.5], i & 2 ? [1, 2] : []); s += r.length * r[0]; } return s; };
show("run", () => run(200));
class Made extends Array { } const set = [1, 2]; set.constructor = { [Symbol.species]: Made }; show("species of one", () => join(set, [3]).constructor.name + join([3], set).constructor.name);
for (const line of out) console.log(line);
