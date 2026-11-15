"use strict";
const attempt = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const hide = (v) => [v][JSON.parse("0")];
let kept = null;
function keep(o) { kept = o; }
function bump() { kept.n += 10; kept.late = "laid by another"; }
function viaHidden(o) { hide(o).n += 100; }

function handedOnThenStored(i) { const r = { __proto__: null, n: i }; keep(r); r.n = i + 1; bump(); return [r.n, r.late, kept === r].join(); }
function storedThenHandedOn(i) { const r = { __proto__: null, n: i }; r.n = i + 1; r.own = 1; keep(r); bump(); return [r.n, r.late, r.own].join(); }
function throughHidden(i) { const r = { __proto__: null, n: i }; r.n = i + 1; viaHidden(r); return r.n; }
function twoNames(i) { const r = { __proto__: null, n: i }; const s = r; s.n = 5; r.n += 1; return [r.n, s.n, r === s].join(); }
function inAClosure(i) { const r = { __proto__: null, n: i }; const add = () => { r.n += 1; return r.n; }; r.n = 10; add(); r.n += 1; return [r.n, add()].join(); }
function inAList(i) { const r = { __proto__: null, n: i }; const list = [r]; r.n = 3; list[hide(0)].n += 4; return r.n; }
function inAnotherRecord(i) { const r = { __proto__: null, n: i }; const holder = { __proto__: null, r }; r.n = 3; hide(holder).r.n += 4; return [r.n, holder.r === r].join(); }
function chosen(i, first) { const a = { __proto__: null, n: i }, b = { __proto__: null, n: i + 1 }; const c = first ? a : b; a.n = 10; b.n = 20; c.n += 1; return [a.n, b.n].join(); }
function inALoop(k) { let last = null, sum = 0; for (let i = 0; i < k; i++) { const r = { __proto__: null, n: i }; r.n += 1; if (last) { last.n += 100; sum += last.n; } last = r; } return sum; }
function thrown(i) { const r = { __proto__: null, n: i }; keep(r); try { r.n = 1; hide(null).x; r.n = 2; } catch { return [r.n, kept.n].join(); } }
function frozen(i) { const r = { __proto__: null, n: i }; Object.freeze(r); return [attempt(() => { r.n = 9; }), attempt(() => { r.more = 1; }), r.n].join(); }
function withAGetter(i) { const r = { __proto__: null, n: i, get twice() { return this.n * 2; } }; r.n = 7; return r.twice; }
function withAMethod(i) { const r = { __proto__: null, n: i, up() { this.n += 1; return this; } }; r.n = 7; r.up().up(); return r.n; }
function givenAParentLater(i) { const seen = []; const r = { __proto__: null, n: i }; r.n = 1; Object.setPrototypeOf(r, { set put(v) { seen.push(v); this.n = v; } }); r.put = 5; return [r.n, seen.join(), Object.hasOwn(r, "put")].join(); }
const seenAbove = [];
const parent = { set put(v) { seenAbove.push(this); this.n = v; }, get leak() { seenAbove.push(this); return this.n; }, bump() { this.n += 1000; return this; } };
function belowAParentStoredThrough(i) { const r = { __proto__: parent, n: i }; r.n = 1; r.put = 5; const first = r.n; seenAbove.pop().n += 2; return [first, r.n].join(); }
function belowAParentReadThrough(i) { const r = { __proto__: parent, n: i }; r.n = 1; const got = r.leak; seenAbove.pop().n = 77; return [got, r.n].join(); }
function belowAParentCalledThrough(i) { const r = { __proto__: parent, n: i }; r.n = 1; r.bump(); return r.n; }
function maker(i) { const r = Object.create(null); r.n = i; keep(r); r.n += 1; bump(); return [r.n, r.late].join(); }

const top = Object.create(null);
top.n = 1; keep(top); top.n = 2; bump();
console.log("top", top.n, top.late);
for (const f of [handedOnThenStored, storedThenHandedOn, throughHidden, twoNames, inAClosure, inAList, inAnotherRecord, thrown, frozen, withAGetter, withAMethod, givenAParentLater, belowAParentStoredThrough, belowAParentReadThrough, belowAParentCalledThrough, maker]) { let last = ""; for (let i = 0; i < 40; i++) last = String(f(i)); console.log(f.name, last); }
console.log("chosen", chosen(1, hide(true)), chosen(1, hide(false)));
console.log("inALoop", inALoop(50));
