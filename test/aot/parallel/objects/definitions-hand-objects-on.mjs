// What Object.defineProperty() answers is the object itself: under both names it is stored into, kept, read and handed on.
const show = v => (typeof v === "function" ? "f" : v && typeof v === "object" ? "{" + Reflect.ownKeys(v).join() + "}" : String(v));
const kept = [];
function bothNames(p) { const o = { a: p }; const q = Object.defineProperty(o, "h", { value: 3, writable: true }); q.a = p + 1; const first = o.a; o.a = p + 2; q.h = 4; return [first, q.a, o.h, o === q].join(); }
function keptByAnswer(p) { const o = { a: p }; kept.push(Object.defineProperty(o, "h", { value: p })); kept[kept.length - 1].a = "stored"; return o.a + "," + o.h; }
function answerAlone(p) { return Object.defineProperty({ a: p, b: 2 }, "h", { value: 3 }); }
function chained(p) { return Object.defineProperty(Object.defineProperty({ a: p }, "x", { value: p }), "y", { value: p, enumerable: true }); }
function chainedBothNames(p) { const o = { a: p }; const q = Object.defineProperty(Object.defineProperty(o, "x", { value: p, writable: true }), "y", { value: p }); q.x = 9; q.a = "q"; return [o.x, o.a, o.y, o === q].join(); }
function accessor(p) { const o = { a: p }; const q = Object.defineProperty(o, "g", { get() { return this.a; } }); q.a = p + "q"; return [o.g, q.g, o.a].join(); }
function inBranches(p) { const o = { a: p }; const q = p > 1 ? Object.defineProperty(o, "x", { value: 1 }) : Object.defineProperty(o, "x", { get: () => 2 }); q.a = 7; return [o.a, q.x, o.x].join(); }
function ofClosure(p) { const o = { a: p }; const f = () => o.a; const q = Object.defineProperty(o, "h", { value: 1 }); q.a = 8; return f() + o.a; }
function inLoop(n) { const all = []; let s = ""; for (let i = 0; i < n; i++) { const o = { a: i, b: 2 }; const q = Object.defineProperty(o, "h", { value: i, writable: true }); if (i & 1) all.push(q); q.a += 10; q.h += 1; s += o.a + ":" + o.h + ";"; } return s + all.map(o => o.a + "/" + o.h).join(); }
function copied(p) { const o = { a: p }; const q = Object.defineProperty(o, "e", { value: 1, enumerable: true, writable: true }); q.e = 5; return JSON.stringify({ ...o, ...q }) + Object.keys(o); }
function frozen(p) { const o = { a: p }; const q = Object.freeze(Object.defineProperty(o, "h", { value: 1 })); try { o.a = 3; } catch (e) { return e.constructor.name + q.a + Object.isFrozen(o); } return "stored"; }
function compared(p) { const o = { a: p }; const q = Object.defineProperty(o, "h", { value: 1 }); return [q === o, Object.is(q, o), new Set([o, q]).size, new Map([[o, 1]]).get(q)].join(); }
function nested(p) { const o = { s: null }; const inner = Object.defineProperty((o.s = {}), "v", { value: p, writable: true }); inner.v++; return o.s.v + "," + (o.s === inner); }
function inherited(p) { const o = { a: p }; const child = Object.create(Object.defineProperty(o, "h", { value: 1 })); Object.defineProperty(o, "late", { value: 2 }); return [child.a, child.h, child.late].join(); }
class Made { constructor(p) { this.a = p; const q = Object.defineProperty(this, "h", { value: p, writable: true }); q.h = "h"; q.a = "a"; this.sum = this.a + this.h; } }
for (let p = 0; p < 4; p++) {
  console.log(bothNames(p), keptByAnswer(p), show(answerAlone(p)), answerAlone(p).h, show(chained(p)), chained(p).y, chainedBothNames(p));
  console.log(accessor(p), inBranches(p), ofClosure(p), inLoop(p + 2), copied(p), frozen(p), compared(p), nested(p), inherited(p), JSON.stringify(new Made(p)), new Made(p).h);
}
let s = "";
const make = () => Object.defineProperty({ a: 1, b: 2 }, "h", { value: 3 });
for (let i = 0; i < 4; i++) { const o = make(); s += o.a + o.h + Object.keys(o).length; }
console.log(s, kept.map(o => o.a + o.h).join());
