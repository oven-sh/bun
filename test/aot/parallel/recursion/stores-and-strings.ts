// @ts-nocheck
// Functions that call themselves and store into arrays of every kind of storage, append behind the last element, and compare strings.
const log = [];
function swap(a, i, j) { if (i >= j) return a.length; const x = a[i]; a[i] = a[j]; a[j] = x; return swap(a, i + 1, j - 1) + 0; }
function quick(a, lo, hi) { if (lo >= hi) return; const p = a[hi]; let i = lo; for (let j = lo; j < hi; j++) if (a[j] < p) { const x = a[i]; a[i] = a[j]; a[j] = x; i++; } const y = a[i]; a[i] = a[hi]; a[hi] = y; quick(a, lo, i - 1); quick(a, i + 1, hi); }
function down(a, i, n) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < n && a[l] > a[m]) m = l; if (r < n && a[r] > a[m]) m = r; if (m !== i) { const x = a[i]; a[i] = a[m]; a[m] = x; down(a, m, n); log.push(m); } }
function fill(a, i, n) { if (i === n) return i; a[i] = i * 2; return fill(a, i + 1, n) + 1; }
function append(a, n) { if (n === 0) return a.length; a[a.length] = n % 3 === 0 ? n / 2 : n; return append(a, n - 1) + 0; }
function back(a, n) { if (n < 0) return 0; a[n] = n === 2 ? "two" : n === 4 ? 0.5 : n; return back(a, n - 1) + 1; }
function add(a, node, lo, hi, i, v) { if (lo === hi) { a[node] = v; return; } const m = (lo + hi) >> 1; if (i <= m) add(a, node * 2, lo, m, i, v); else add(a, node * 2 + 1, m + 1, hi, i, v); a[node] = a[node * 2] + a[node * 2 + 1]; }
function mark(g, x, y, c) { if (y < 0 || x < 0 || y >= g.length || x >= g[y].length || g[y][x] !== ".") return 0; g[y][x] = c; return 1 + mark(g, x + 1, y, c) + mark(g, x, y + 1, c); }
function count(s, i, w) { if (i >= s.length) return 0; return (s[i] === w ? 1 : 0) + (s[i] === "é" ? 10 : 0) + (s.slice(i, i + 3) === "abc" ? 100 : 0) + count(s, i + 1, w); }
function evaluate(e) { switch (e.kind) { case "number": return e.value; case "add": return evaluate(e.l) + evaluate(e.r); case "multiply": return evaluate(e.l) * evaluate(e.r); case "negate": return -evaluate(e.e); } return e.kind === "nan" ? NaN : e.kind; }
const makers = [() => [5, 3, 9, 1, 7, 2], () => [1.5, 0.5, 2.5, -0, NaN], () => [5, "b", 2, null, undefined, 1.5], () => [, 3, , 1], () => [], () => new Array(7), () => new Array(6).fill(0), () => Object.freeze([3, 2, 1]), () => new (class extends Array {})(4).fill(1),
  () => new Float64Array([3, 1, 2, 0]), () => new Uint8Array([3, 1, 2, 0]), () => ({ 0: 3, 1: 2, length: 2 }), () => new Proxy([3, 1, 2], {}), () => { const a = [3, 1, 2, 4]; Object.defineProperty(a, 1, { get() { log.push("g"); return 7; }, set(v) { log.push("s" + v); } }); return a; },
  () => { const a = [3, 1]; a[2000] = 5; return a; }, () => Object.setPrototypeOf([2, , 1], { 1: 11, set 5(v) { log.push("p" + v); }, __proto__: Array.prototype }), () => [2147483647, -2147483648, 4294967296, 0], () => [1n, 2n, 0n], () => [true, false], () => Object.seal([4, 2]), () => [[1], [2]]];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : typeof v === "bigint" ? v + "n" : String(v);
function call(name, f) { let answer; try { answer = show(f()); } catch (e) { answer = e.name; } return name + "=" + answer; }
makers.forEach((make, place) => {
  const said = [];
  for (const [name, f] of [["swap", a => swap(a, 0, 3)], ["quick", a => quick(a, 0, a.length > 20 ? 3 : a.length - 1)], ["down", a => down(a, 0, 4)], ["fill", a => fill(a, 0, 5)], ["append", a => append(a, 4)], ["back", a => back(a, 5)], ["add", a => add(a, 1, 0, 1, 1, 8)]]) {
    const a = make(); said.push(call(name, () => f(a)), call(name, () => f(a)));
    const held = []; for (let i = 0; i < Math.min(a.length, 8); i++) held.push(i in a ? show(a[i]) : "hole"); said.push(held.join());
  }
  console.log(place, said.join(" "), log.join(" ")); log.length = 0;
});
console.log(mark([..."..#.", "....", "#..."].map(r => r.split("")), 0, 0, "o"), count("abcabé" + "abc".repeat(3), 0, "a"), count("x" + String.fromCharCode(0x3b1) + "abc", 0, "x"));
const n = value => ({ kind: "number", value });
console.log(evaluate({ kind: "add", l: n(2), r: { kind: "multiply", l: n(3), r: { kind: "negate", e: n(4) } } }), evaluate({ kind: "nan" }), evaluate({ kind: "add", l: n(1), r: { kind: "other" } }), evaluate({ kind: "mul" + "tiply", l: n(5), r: n(6) }));
