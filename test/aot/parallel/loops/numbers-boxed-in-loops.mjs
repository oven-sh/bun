// A double is boxed in a loop: whole numbers as int32s, zero by its sign, everything else as it is.
const values = JSON.parse("[0, 1, -1, 0.5, -0.5, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 1e300, -1e300, 3, 1e-320, 9007199254740992, 5]");
values.push(-0, NaN, Infinity, -Infinity);
const show = v => (Object.is(v, -0) ? "-0" : String(v));
const out = [];
function fields(xs, f) { const o = { a: 0, s: 0, n: 0, m: "" }; for (let i = 0; i < xs.length; i++) { o.a = xs[i] * f; o.s += xs[i] * f; o.n += 1 / f; out.push(show(o.a)); } return [show(o.s), show(o.n)]; }
function lists(xs, f) { const boxed = ["t"]; for (let i = 0; i < xs.length; i++) boxed[i + 1] = xs[i] - f; return boxed.map(show); }
function products(xs, f) { const all = [null]; for (const x of xs) all.push(x * f); return all.slice(1).map(x => show(x) + typeof x); }
function zeros(n, step) { const o = { v: 1.5, list: [] }; for (let i = 0; i < n; i++) { o.v = i * step - i * step; if (i & 1) o.v = -o.v; o.list.push(show(o.v)); } return o.list; }
function indexes(xs) { const table = ["a", "b", "c", "d", "e", "f", "g", "h"], o = { k: 0 }; let t = ""; for (let i = 0; i < 24; i++) { o.k = (xs[i % 4] + i) * 0.5; t += table[o.k] ?? "-"; } return t; }
class Sum { constructor(xs) { this.sum = 0; this.seen = 0; for (const x of xs) { this.sum += x; this.seen++; } this.half = this.sum / 2; } }
for (let turn = 0; turn < 20; turn++) {
  out.length = 0;
  out.push(...fields(values, 1), ...fields(values, -1), ...fields(values, 0.5), ...fields(values, 0));
  out.push(...lists(values, 0), ...lists(values, 1), ...lists(values, 0.25));
  out.push(...products(values, 1), ...products(values, 0), ...products(values, -2), ...products(values, 0.5));
  out.push(...zeros(6, 1), ...zeros(6, 0.5), ...zeros(6, -1), indexes(values));
  for (const xs of [[1, -1], [0.5, -0.5], [-0], [-0, -0], [2147483647, 1], [0.1, 0.2], [], [NaN, 1]]) { const s = new Sum(xs); out.push(show(s.sum), show(s.seen), show(s.half), JSON.stringify(s)); }
}
let hash = 0; for (const s of out) for (const c of s) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
console.log(hash, out.length); console.log(out.join(" "));
