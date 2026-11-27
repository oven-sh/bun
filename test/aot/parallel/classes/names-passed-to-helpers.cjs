// STATISTIC: AccessesUnderPassedNames >= 8
// `function def(target, name, value) { target[name] = value; }`, where every call is in sight and passes a written name.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
const describe = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? "{}" : String(v);
function hot(C, n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) list.push(new C(i, i + 1)); for (let k = 0; k < n; k++) { const p = list[k & 7]; total = (total + p.step(k).sum()) | 0; } return total; }
function def(p, n, f) { p[n] = f; }
function A(x, y) { this.x = x; this.y = y; }
def(A.prototype, "sum", function () { return this.x + this.y; });
def(A.prototype, "step", function (k) { this.x = (this.x + k) & 1023; return this; });
def(A, "made", "static");
def(A.prototype, "kind", "a");
tell("def", () => [hot(A, 800), A.made, new A(1, 2).kind, Object.keys(A.prototype)]);
function B(x, y) { this.x = x; this.y = y; }
function method(n, f) { B.prototype[n] = f; }
method("sum", function () { return this.x * 2 + this.y; });
method("step", function (k) { this.x = (this.x + k) & 1023; return this; });
tell("method", () => hot(B, 800));
method("sum", function () { return 7; });
tell("again", () => hot(B, 80));
function wrap(p, n) { const inner = p[n]; p[n] = function () { return inner.apply(this, arguments) + 1; }; }
wrap(A.prototype, "sum");
tell("wrapped", () => [hot(A, 800), new A(1, 2).sum()]);
class P { constructor(x, y) { this.x = x; this.y = y; this.next = null; } sum() { return this.x + this.y; } step(k) { this.x = (this.x + k) & 1023; return this; } }
function set(o, n, v) { o[n] = v; return o; }
function get(o, n) { return o[n]; }
tell("set", () => { const p = set(new P(1, 2), "x", 5); set(p, "late", "l"); set(p, "next", set(new P(3, 4), "y", 1.5)); return [p.sum(), get(p, "late"), get(p, "next").sum(), get(p, "missing") === undefined, hot(P, 500), Object.keys(p)]; });
class Q { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } step(k) { this.x = (this.x + k) & 1023; return this; } }
const wrapQ = (p, n) => { const inner = p[n]; p[n] = function (...a) { return inner.apply(this, a) * 2; }; };
wrapQ(Q.prototype, "sum");
tell("wrapped class", () => [hot(Q, 500), new Q(1, 2).sum()]);
function other(o, n, v) { o[n] = v; }
class R { constructor(a) { this.a = a; } m() { return this.a; } }
tell("unwritten name", () => { const r = new R(1); other(r, "a", 2); other(r, process.argv[2] || "m", 3); return [r.a, r.m, Object.keys(r)]; });
function alias(o, n, v) { o[n] = v; }
const same = alias;
tell("held elsewhere", () => { const r = new R(1); alias(r, "a", 2); same(r, "m", "other"); return [r.a, r.m]; });
function called(o, n, v) { o[n] = v; }
tell("by call", () => { const r = new R(1); called(r, "a", 2); called.call(null, r, "m", "c"); called.apply(null, [r, "z", 1]); return [r.a, r.m, r.z]; });
function spread(o, n, v) { o[n] = v; }
tell("spread", () => { const r = new R(1); spread(...[r, "m", "s"]); spread(r, "a", 4); return [r.a, r.m]; });
function few(o, n, v) { o[n] = v; }
tell("few arguments", () => { const r = new R(1); few(r, "a"); return [describe(r.a), Object.keys(r)]; });
function proto(o, n, v) { o[n] = v; }
tell("prototype link", () => { const r = new R(1); proto(r, "a", 2); proto(r, "__proto__", { a: 9, m() { return "above"; } }); return [r.a, r.m(), r instanceof R]; });
function digit(o, n, v) { o[n] = v; }
tell("digits", () => { const r = new R(1), l = ["x"]; digit(r, "0", "zero"); digit(l, "1", "y"); digit(l, "length", 1); return [r[0], l]; });
function changed(o, n, v) { if (v > 1) n = "m"; o[n] = v; }
tell("changed name", () => { const r = new R(1); changed(r, "a", 1); changed(r, "a", 2); return [r.a, r.m]; });
function preset(o, n = "m", v = 5) { o[n] = v; }
tell("preset name", () => { const r = new R(1); preset(r); preset(r, "a", 6); return [r.a, r.m]; });
function itself(o, n, v) { if (v > 0) itself(o, "m", 0); o[n] = v; }
tell("itself", () => { const r = new R(1); itself(r, "a", 2); return [r.a, r.m]; });
function listed(o, n, v) { arguments[1] = "m"; o[n] = v; }
tell("arguments", () => { const r = new R(1); listed(r, "a", 2); return [r.a, describe(r.m)]; });
function made(n, v) { this[n] = v; }
tell("constructed", () => { const r = new made("a", 2); return [r.a, Object.keys(r)]; });
tell("nested", () => { class N { constructor() { this.a = 1; } m() { return this.a; } } const put = (n, f) => { N.prototype[n] = f; }; put("m", function () { return "put" + this.a; }); put("k", () => "k"); const o = new N(); return [o.m(), o.k()]; });
tell("in a loop", () => { class N { constructor() { this.a = 1; } m() { return this.a; } } const put = (o, n, v) => { o[n] = v; }; let o; for (let i = 0; i < 3; i++) { o = new N(); put(o, "a", i); put(o, "b", "b" + i); } return [o, o.m()]; });
function setter(o, n, v) { o[n] = v; }
class S { constructor() { this.n = 0; } set v(x) { this.n += x; } get v() { return "got" + this.n; } }
tell("setter", () => { const s = new S(); setter(s, "v", 4); setter(s, "n", s.n + 1); return [s.v, Object.keys(s)]; });
function frozen(o, n, v) { o[n] = v; }
tell("frozen", () => { const r = Object.freeze(new R(1)); frozen(r, "a", 2); frozen(r, "b", 3); return [r.a, r.b === undefined]; });
for (const line of out) console.log(line);
