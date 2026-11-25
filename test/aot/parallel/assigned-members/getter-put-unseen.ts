// @ts-nocheck
// STATISTIC: AssignedMemberChecks >= 3
// A decorated getter, and other closures of the same wrapper that unseen code puts over it.
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e.name}: ${e.message}`; } console.log(label, r); };
const hidden = x => JSON.parse("[0]", (key, value) => key === "0" ? x : value[0]);
function d(f, c) { return function () { return f.call(this) + 1; }; }
class A { k = 2; @d get v() { return this.k; } }
const put = k => hidden(Object)[["define", "Property"].join("")](hidden(A).prototype, "v", { get: d(function () { return this.k * k; }, {}), configurable: true });
let a = new A();
function run() { let s = 0; for (let i = 0; i < 200; i++) s += a.v; return s; }
function change(i) { if (i === 60) put(100); if (i === 120) put(1000); return i > 1e9 ? change(i - 1) : 0; }
function inside() { let s = 0; for (let i = 0; i < 200; i++) { s += a.v; s += change(i); s += a.v; } return s; }
show("first", run); put(7); show("put", run); put(11); show("put again", run); show("inside", inside); show("behind", run);
Bun.gc(true); show("collected", run);
export {};
