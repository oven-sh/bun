// Lists in fields that loops drain: by methods, in bodies of their own and through objects, of every kind, changed on the way.
const show = x => Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from({ length: x.length }, (_, i) => i in x ? x[i] : "hole").map(show).join() + "]" : typeof x === "object" && x ? "{" + Object.keys(x).map(k => show(x[k])) + "}" : typeof x === "bigint" ? x + "n" : String(x);
class Stack { items = []; push(x) { this.items.push(x); } pop() { return this.items.pop(); } peek() { return this.items[this.items.length - 1]; } isEmpty() { return this.items.length === 0; } drain() { let s = 0; while (this.items.length > 0) s += this.items.pop(); return s; } fill(L) { for (let i = 0; i < L.length; i++) this.items.push(L[i]); } some(n) { let s = 0; for (let i = 0; i < n; i++) s += this.items.pop(); return s; } }
const kept = new Stack(), made = L => { const q = new Stack(); for (let i = 0; i < L.length; i++) q.push(L[i]); return q; };
function drained(L) { const q = made(L); let s = 0; while (!q.isEmpty()) s += q.pop(); return [s, q]; }
function peeked(L) { const q = made(L); let s = 0; while (!q.isEmpty()) { s += q.peek(); q.pop(); } return [s, q]; }
function own(L) { const q = new Stack(); q.fill(L); return [q.drain(), q]; }
function past(L) { const q = new Stack(); q.fill(L); return [q.some(L.length + 2), q]; }
function field(L) { const q = { items: [] }; for (let i = 0; i < L.length; i++) q.items.push(L[i]); let s = 0; while (q.items.length) s += q.items.pop(); return [s, q.items]; }
function module(L) { kept.items = []; for (let i = 0; i < L.length; i++) kept.push(L[i]); let s = 0; while (!kept.isEmpty()) s += kept.pop(); return [s, kept.items]; }
function given(L) { const q = new Stack(); q.items = L; let s = 0; while (!q.isEmpty()) s += q.pop(); return [s, L]; }
function replaced(L) { const q = made(L); let s = 0; while (!q.isEmpty()) { s += q.pop(); if (q.items.length === 2) q.items = [0.5, "r"], s += 1000; if (s > 1500 || typeof s === "string") break; } return [s, q]; }
function shared(L) { const q = made(L), l = q.items; let s = 0; while (!q.isEmpty()) { s += q.pop(); if (l.length === 2) l[0] = "first"; } return [s, l]; }
function refilled(L) { const q = made(L); let s = 0, n = 0; while (!q.isEmpty() && n++ < 40) { const x = q.pop(); s += x; if (n % 3 === 0) q.push(x); } return [s, q]; }
function text(L) { const q = made(L); let s = ""; while (!q.isEmpty()) s += q.pop(); return s; }
function least(L) { const q = made(L); let m = Infinity; while (!q.isEmpty()) { const x = q.pop(); if (x < m) m = x; } return m; }
function until(L) { const q = made(L); let x, n = 0; while ((x = q.pop()) !== undefined) n += x === 3 ? 100 : 1; return [n, q]; }
const inputs = [() => [5, 3, 8, 1, 9, 2], () => [1.5, 0.5, 2.5], () => [1, 2, 2.5, 3], () => [1, 2, 3, 4, "late"], () => ["early", 1.5, 2.5], () => [3, , 1], () => [1.5, , 2], () => ["b", "a"], () => [], () => [NaN, -0, 1], () => [undefined, null, true], () => JSON.parse("[4,3,2]"), () => JSON.parse("[4.5,3]"), () => Object.freeze([1, 2, 3]), () => [1n, 2n], () => [{ v: 1 }], () => [2147483647, 2147483648], () => Object.defineProperty([1, 2, 3], 2, { get() { return 5.5; }, configurable: true }), () => new (class extends Array {})(3).fill(2), () => Array.from({ length: 40 }, (_, i) => i < 30 ? i / 3 : i)];
for (let turn = 0; turn < 4; turn++)
  for (const input of inputs)
    for (const run of [drained, peeked, own, past, field, module, given, replaced, shared, refilled, text, least, until]) {
      let said;
      try { said = show(run(input())); } catch (e) { said = "!" + e.constructor.name; }
      console.log(run.name, said.slice(0, 100));
    }
