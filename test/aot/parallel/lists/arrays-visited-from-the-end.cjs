// reduceRight, findLast and findLastIndex over every kind of storage, holes, arrays that change under the callback, array-likes, proxies, heirs.
"use strict";
const out = [];
const told = v => Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : Array.isArray(v) ? "[" + v.map(told).join() + "]" : typeof v === "object" && v ? "{}" : typeof v + " " + String(v);
const show = (name, f) => { let r; try { r = told(f()); } catch (e) { r = e.constructor.name + ": " + e.message; } out.push(name + " " + r); };
const accessor = () => { const l = [1, 2, 3]; Object.defineProperty(l, 1, { get() { return "got"; }, configurable: true }); return l; };
const makers = { empty: () => [], one: () => [7], ints: () => [1, 2, 3, 4, 2, 1], doubles: () => [0.5, 1.5, -0, 2.5], nan: () => [NaN, 1.5], mixed: () => [1, "a", null, undefined, {}, true, 10n, 0.5], holes: () => [1, , 3, , 5], ends: () => [, 1, 2, , ], allHoles: () => new Array(4), holesOfDoubles: () => [0.5, , 1.5], texts: () => ["a", "b", "c"], long: () => Array.from({ length: 70 }, (_, i) => i), sparse: () => { const l = [1]; l[3000] = 2; return l; }, accessor, frozen: () => Object.freeze([1, 2, 3]), heir: () => (class List extends Array { }).from([1, 2, 3]), proxy: () => new Proxy([1, 2, 3], { has(t, k) { out.push("has " + String(k)); return k in t; } }), words: () => "x y z".split(" ") };
function fold(l, f, ...i) { return l.reduceRight(f, ...i); } function last(l, f, t) { return l.findLast(f, t); } function lastIndex(l, f, t) { return l.findLastIndex(f, t); }
for (const name of Object.keys(makers)) {
  show(name + " order", () => { const seen = []; fold(makers[name](), (a, v, i, l) => { seen.push(told(v) + i + typeof i + l.length); return a; }, 0); return seen.join(); });
  show(name + " folded", () => fold(makers[name](), (a, v) => String(a) + "|" + told(v))); show(name + " with start", () => fold(makers[name](), (a, v) => a + String(typeof v === "symbol" ? "s" : typeof v === "object" ? "o" : v), "")); show(name + " sum", () => fold(makers[name](), (a, v) => a + (typeof v === "number" ? v : 1), 0));
  show(name + " last", () => last(makers[name](), v => v)); show(name + " last undefined", () => last(makers[name](), v => v === undefined)); show(name + " last index", () => [lastIndex(makers[name](), v => v === undefined), lastIndex(makers[name](), v => v === 2), lastIndex(makers[name](), () => false), lastIndex(makers[name](), v => typeof v === "string")]);
  show(name + " seen", () => { const seen = []; last(makers[name](), function (v, i, l) { seen.push(i + told(v) + this.x + l.length); }, { x: 1 }); lastIndex(makers[name](), function (v, i) { seen.push(i + told(v) + this.x); }, { x: 2 }); return seen.length > 100 ? seen.length + seen[0] + seen[99] : seen.join(); });
}
const changes = { shorter: l => { l.length = 2; }, longer: l => { l.push(9, 9); }, emptied: l => { l.length = 0; }, popped: l => { l.pop(); }, doubles: l => { l[1] = 0.5; }, texts: l => { l[0] = "s"; }, deleted: l => { delete l[1]; }, sparse: l => { l[100000] = 1; }, shifted: l => { l.shift(); } };
for (const change of Object.keys(changes)) for (const at of [4, 2, 0]) for (const make of [() => [1, 2, 3, 4, 5], () => [0.5, 1, 1.5, 2, 2.5], () => ["a", "b", "c", "d", "e"]]) {
  show("fold " + change + at, () => { const l = make(); return fold(l, (a, v, i) => { if (i === at) changes[change](l); return a + told(v) + i + ";"; }, "") + l.length; });
  show("last " + change + at, () => { const l = make(); let s = ""; last(l, (v, i) => { if (i === at) changes[change](l); s += told(v) + i + ";"; return false; }); lastIndex(l, (v, i) => { s += told(v) + i + ","; return false; }); return s + l.length; });
}
for (const l of [{ length: 3, 0: "a", 2: "c" }, { length: -1 }, { length: "2", 0: 1, 1: 2 }, "text", 5, null, new Uint8Array([1, 2, 3]), { length: 2 ** 53, [2 ** 53 - 2]: "end" }]) { if (l === null || typeof l !== "object" || l.length < 10) show("like " + told(l), () => [Array.prototype.reduceRight.call(l, (a, v, i) => a + v + i, ""), Array.prototype.findLast.call(l, v => v), Array.prototype.findLastIndex.call(l, v => v)]); else show("like long", () => Array.prototype.findLast.call(l, v => v)); }
for (const f of [undefined, null, 5, {}]) show("no function " + told(f), () => fold([1], f)), show("no function", () => last([1], f)), show("no function", () => lastIndex([1], f));
show("empty fold", () => fold([], (a, b) => a)); show("holes fold", () => fold(new Array(3), (a, b) => a)); show("thrown", () => fold([1, 2], () => { throw new RangeError("from callback"); }));
const run = n => { let s = 0; const lists = [[1, 2, 3], [0.5, 1.5], [1, , 3], ["a", "b"]]; for (let i = 0; i < n; i++) { const l = lists[i & 3]; s += fold(l, (a, v) => a + (v === "a" || v === "b" ? 1 : v), 0) + lastIndex(l, v => v === 1 || v === 0.5 || v === "a"); s += last(l, v => v !== undefined) === l[l.length - 1] ? 1 : 0; } return s; };
show("run", () => run(800));
for (const line of out) console.log(line);
