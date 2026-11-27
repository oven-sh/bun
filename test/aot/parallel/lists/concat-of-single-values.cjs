// concat() of one value that is no array onto receivers nobody knows, of two empty arrays, and of objects that decide themselves.
"use strict";
const out = [];
const told = v => Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : typeof v === "object" && v ? Array.isArray(v) ? "[" + v.length + "]" : "{}" : typeof v + " " + String(v);
const text = l => Array.isArray(l) ? l.length + "[" + Array.from({ length: Math.min(l.length, 30) }, (_, i) => i in l ? told(l[i]) : "hole").join() + "]" : told(l);
const show = (name, f) => { let r; try { r = text(f()); } catch (e) { r = e.constructor.name + ": " + e.message; } out.push(name + " " + r); };
function join(a, b) { return a.concat(b); }
const joinedText = "jo" + "in".repeat(out.length + 1), spread = { length: 2, 0: "x", 1: "y", [Symbol.isConcatSpreadable]: true }, asked = []; const asks = { get [Symbol.isConcatSpreadable]() { asked.push("asked"); return false; } };
const values = [1, 0, -1, 2 ** 31 - 1, -(2 ** 31), 2 ** 31, 2 ** 53, 0.5, -0, 1e300, NaN, Infinity, "", "text", joinedText, "some text".slice(2, 6), "Ж", true, false, null, undefined, 10n, 2n ** 70n, Symbol.iterator, () => 1, {}, spread, asks, new Date(0), /x/, new Uint8Array([1, 2]), new String("boxed"), new Proxy([1, 2], {}), new Proxy({}, {}), new Map([[1, 2]]), (class List extends Array { }).from([7, 8])];
const makers = { empty: () => [], ints: () => [1, 2], doubles: () => [0.5, -0], whole: () => [2.5, 3], texts: () => ["a"], mixed: () => [1, "a", null], holes: () => [1, , 3], holesOfDoubles: () => [0.5, , 1.5], made: () => new Array(2), frozen: () => Object.freeze([1]), named: () => { const l = [1]; l.name = 1; return l; }, sparse: () => { const l = []; l[3000] = 1; return l; }, long: () => Array.from({ length: 300 }, (_, i) => i), near: () => Array.from({ length: 256 }, (_, i) => i + 0.5), heir: () => (class List extends Array { }).from([1]), popped: () => { const l = ["x"]; l.pop(); return l; }, poppedDoubles: () => { const l = [0.5]; l.pop(); return l; }, proxy: () => new Proxy([1], {}), word: () => "word" };
for (const a of Object.keys(makers)) for (let k = 0; k < values.length; k++) show(a + " " + k, () => join(makers[a](), values[k]));
for (const a of ["empty", "popped", "poppedDoubles", "made", "heir"]) for (const b of ["empty", "popped", "poppedDoubles", "made", "heir"]) show(a + " and " + b, () => join(makers[a](), makers[b]()));
out.push(asked.length + "");
show("written to", () => { const a = [], r = join(a, "x"), e = join([], []), d = join([1], 0.5); r.push(1); e.push("e"); e.push(0.5); e.push(2); d.push("d"); a.push(5); return [text(a), text(r), text(e), text(d), join([], []) === join([], [])]; });
show("own", () => { const l = [1]; l[Symbol.isConcatSpreadable] = false; return join(l, 2); }); show("species", () => { class Made extends Array { } const l = [1]; l.constructor = { [Symbol.species]: Made }; return [join(l, 2).constructor.name]; });
show("collected", () => { let t = []; for (let i = 0; i < 500; i++) { t = join(t.length > 20 ? [] : t, i % 3 === 0 ? "t" + i : i % 3 === 1 ? { i } : i * 0.5); if (i % 200 === 199 && typeof Bun === "object") Bun.gc(true); } return t.map(x => typeof x === "object" ? x.i : x); });
const run = n => { let s = 0; for (let i = 0; i < n; i++) { const r = join(i & 1 ? [] : ["a"], i % 3 === 0 ? "b" : i % 3 === 1 ? i : []); s += r.length; } return s; }; show("run", () => run(300));
for (const l of out) console.log(l);
