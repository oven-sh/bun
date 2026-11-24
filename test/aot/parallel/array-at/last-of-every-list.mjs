// at(-1) of lists of every kind in loops and alone.
function leaf(x) { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? (Array.isArray(x) ? "[" + x.length + "]" : "object:" + String(x.x)) : `${typeof x}:${String(x)}`; }
class P { constructor(x) { this.x = x; this.y = x + 1; } }
class Own extends Array {}
class Replaced extends Array { at(i) { return "replaced " + String(i); } }
const getter = () => { const a = [1, 2, 3]; Object.defineProperty(a, 2, { get() { return 33; }, configurable: true }); return a; };
const lists = [
  () => [1, 2, 3, 4, 5], () => [1.5, 2.5, 3.5], () => [new P(1), new P(2), new P(3)], () => ["a", "bc"], () => [1, "a", null, undefined, new P(4)], () => [], () => [7], () => [1, , 3, ,], () => [1.5, , 2.5, ,], () => [, new P(1), ,], () => new Array(5),
  () => { const a = [1, 2, 3]; a.length = 6; return a; }, () => { const a = [1, , 3]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: "inherited", 5: "far" }); return a; }, () => Own.of(1, 2, 3), () => Replaced.of(1, 2, 3), getter, () => Object.freeze([1, 2, 3]),
  () => { const a = [1, 2, 3]; a.at = i => "own " + String(i); return a; }, () => Int32Array.of(1, 2, 3), () => Float64Array.of(1.5, 2.5), () => "text", () => ({ length: 3, 0: 1, 1: 2, 2: 3, at(i) { return "method " + String(i); } }), () => JSON.parse("[1,2.5,null]"), () => [NaN, -0, 1], () => { const a = []; a[50] = 1; return a; }, () => [[1, 2], [3]],
];
function f0(a, n, k) { let s = ""; for (let i = 0; i < n; i++) { s += leaf(a.at(-1)) + ";"; } return s; }
function f1(a, n, k) { let s = ""; for (let i = 0; i < n; i++) { const p = a.at(-1); if (p) s += leaf(p.x) + leaf(p); else s += leaf(p); } return s; }
function f2(a, n, k) { let s = ""; for (let i = 0; i < n; i++) { s += String(a.at(-1) + 1); } return s; }
function f3(a, n, k) { let s = ""; for (let i = 0; i < n; i++) { s += a.at?.(-1) === a[0] ? "same" : "other"; } return s; }
function f4(a, n, k) { let s = ""; for (let i = 0; i < n; i++) { if (Array.isArray(a) && !Object.isFrozen(a) && i === 2) a.push(i); s += leaf(a.at(-1)); } return s; }
function f5(a, n, k) { let s = ""; for (let i = 0; i < n; i++) { if (Array.isArray(a) && !Object.isFrozen(a) && i === 2) a.pop(); s += leaf(a.at(-1)) + a.length; } return s; }
function f6(a, n, k) { let s = ""; for (let i = 0; i < n; i++) { let t = 0; t += a.at(-1); s += leaf(t); } return s; }
function f7(a, n, k) { const i = 1; return leaf(a.at(-1)); }
function f8(a, n, k) { let m = 0; for (let i = 0; i < n; i++) { const v = a.at(-1); if (typeof v === "number") m = m * 2 + v; else m -= 1; } return leaf(m); }
const functions = [f0, f1, f2, f3, f4, f5, f6, f7, f8];
for (let l = 0; l < lists.length; l++) {
  const out = [];
  for (const run of functions) for (const n of [5, 1]) { let answer; try { answer = run(lists[l](), n, l - 10); } catch (e) { answer = e.constructor.name; } out.push(answer); }
  console.log(l, out.join(" "));
}
