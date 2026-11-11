// COUNTER: operationAOTPutByIdAndCache <= 20
"use strict";
const attempt = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const hide = (v) => [v][JSON.parse("0")];
const show = (o) => [Object.keys(o).join(), JSON.stringify(o), (() => { const seen = []; for (const k in o) seen.push(k); return seen.join(); })(), Object.getPrototypeOf(o) === null].join(" | ");

function point(i) { const r = Object.create(null); r.id = i; r.x = i * 2; if (i & 1) r.odd = true; return r; }
let sum = 0; const kept = [];
for (let i = 0; i < 200; i++) { const p = point(i); sum += p.id + p.x + (p.odd ? 1 : 0); if (i < 3) kept.push(p); }
console.log("records out of a function", sum, kept.map(show).join(" / "));

const inLoop = [];
for (let i = 0; i < 3; i++) { const r = Object.create(null); r.z = i; r.a = i + 1; inLoop.push(r); }
console.log("in a loop", inLoop.map(show).join(" / "));

function count(words) { const counts = Object.create(null); counts.total = 0; for (const w of words) { counts[w] = (counts[w] || 0) + 1; counts.total++; } return counts; }
console.log("a table with one written name", show(count(["b", "a", "b", "__proto__", "total"])));

const root = Object.create(null);
root.go = (x) => x + 1;
root.shared = "from the root";
function scopes(n) { let last = 0; for (let i = 0; i < n; i++) { const a = Object.create(root), b = Object.create(a); a["v" + (i & 3)] = i; last += b[hide("go")](i) + (b.shared === "from the root" ? 1 : 0) + ("v" + (i & 3) in b ? 1 : 0); } return last; }
console.log("a parent", scopes(50), show(root));

function described(i) { const r = Object.create(null); r.plain = i; Object.defineProperty(r, "got", { get() { return this.plain * 2; }, enumerable: true }); return r; }
console.log("defined on", described(4).got, show(described(5)));

const inAnArrow = Object.create(null);
inAnArrow.name = 1;
const below = () => Object.create(inAnArrow);
console.log("a parent named in an arrow", below().name, Object.getPrototypeOf(below()) === inAnArrow, show(inAnArrow));

function nested(i) { const outer = Object.create(null); outer.inner = Object.create(null); outer.inner.deep = i; outer.n = i; return outer; }
console.log("one in another", JSON.stringify(nested(3)), nested(4).inner.deep);
function shadowed(r) { { const r = Object.create(null); r.a = 1; if (hide(false)) return r; } r.b = 2; return r; }
console.log("two of one name", JSON.stringify(shadowed({})));
function thrown(i) { const r = Object.create(null); try { r.a = i; hide(null).x; r.b = 2; } catch { return show(r); } }
console.log("a throw between two stores", thrown(1));
function recursive(n) { const r = Object.create(null); r.n = n; r.below = n ? recursive(n - 1) : null; return r; }
console.log("recursive", JSON.stringify(recursive(3)));
function* made() { for (let i = 0; i < 2; i++) { const r = Object.create(null); r.i = i; yield r; } }
console.log("in a generator", [...made()].map(show).join(" / "));
async function later(i) { const r = Object.create(null); r.before = i; await null; r.behind = i + 1; return r; }
later(1).then((r) => console.log("across an await", show(r)));
console.log("asked as any object", attempt(() => "" + point(1)), attempt(() => point(1) + 1), point(1) instanceof Object, typeof point(1).toString, "id" in point(1), "toString" in point(1));
