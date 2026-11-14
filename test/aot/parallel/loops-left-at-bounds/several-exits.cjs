// Several exits out of loops over objects whose getters run other code.
const lines = [], keep = []; const show = v => v === undefined ? "u" : Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + Array.from(v, show).join() + "]" : typeof v === "object" && v ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}" : typeof v === "function" ? "fn" : String(v);
class V { constructor(x, y) { this.x = x; this.y = y; } add(o) { return new V(this.x + o.x, this.y + o.y); } get sum() { return this.x + this.y; } }
globalThis.act = null; const unseen = (0, eval)("(function (o, i) { return globalThis.act ? globalThis.act(o, i) : 0; })");
const boom = q => { if (q) throw new RangeError("b" + q); return q; }, pass = q => q, note = q => { lines.push(show(q)); };
function f(a, n, o) { let p = { x: a, y: a }, s = 0, i = 0; o.i = 0; keep.push(p); top: for (let k = 0; k < 3; k++) { do { s += p.x; if (i === 2) { unseen(o, i); break; } i++; } while (i < o.n); i = 0; } keep.push(p); return [p, s, i, o.at]; }
class O { constructor(n) { this.at = 0; this.n = n; this.i = 0; this.stop = 3; this.flag = 0; this.view = new Int32Array(8); } out(q) { return unseen(this, q); } }
globalThis.kinds = [O, V]; let calls = 0;
const guard = g => globalThis.act = g && ((o, i) => { if (++calls > 200) throw new Error("many"); return g(o, i); });
const go = function (a, n, m) { const o = new O(m); try { lines.push(show((function () { return f(a, n, o); })())); } catch (e) { lines.push('T' + (e && e.name || e)); } lines.push(show(o.at) + show(o.i) + show(Array.from(o.view))); };
for (const g of [null, o => { o.n = "3"; }, o => { o.x = "t"; }, o => { o.stop = { valueOf() { return 2; } }; }, o => { Object.defineProperty(o, "y", { get() { return 1; }, set() {}, configurable: true }); }]) { guard(g); calls = 0; for (const [a, n, m] of [[0, 5, 5], [1, 5, 3], [2, 3, 9], [0, 0, 1], [0.5, 8, 4], ["q", 3, 2], [-0, 6, 6]]) go(a, n, m); }
guard(null); let last = 0; for (let k = 0; k < 60; k++) { go(k % 3, 4 + k % 5, 3 + k % 4); last = lines.length; if (last > 400) lines.length = 300; }
console.log(lines.join("\n")); console.log(keep.length, keep.slice(-12).map(show).join(" "));
