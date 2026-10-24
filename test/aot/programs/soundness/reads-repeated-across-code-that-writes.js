// Reads cached across calls, operators and protocols that write; identity of sunk or merged allocations.
class Box { constructor(v) { this.v = v; } }
function across(b, f) { const x = b.v; f(); return x + b.v; }
const b1 = new Box(1); console.log(across(b1, () => { b1.v = 10; }), across(b1, () => {}));
function acrossOperator(b, o) { const x = b.v; const s = o + 1; return [x, s, b.v].join(); }
const b2 = new Box(1); console.log(acrossOperator(b2, { valueOf() { b2.v = "w"; return 1; } }));
function acrossTemplate(b, o) { const x = b.v; const s = `${o}`; return [x, s, b.v].join(); }
const b3 = new Box(1); console.log(acrossTemplate(b3, { toString() { b3.v++; return "t"; } }));
function acrossGetter(b, o) { const x = b.v; const s = o.g; return [x, s, b.v].join(); }
const b4 = new Box(1); console.log(acrossGetter(b4, { get g() { b4.v = null; return "g"; } }));
function acrossCompare(b, o) { const x = b.v; const s = o < 5; return [x, s, b.v].join(); }
const b5 = new Box(1); console.log(acrossCompare(b5, { [Symbol.toPrimitive]() { delete b5.v; return 1; } }));
function acrossIn(b, p) { const x = b.v; const s = "k" in p; return [x, s, b.v].join(); }
const b6 = new Box(1); console.log(acrossIn(b6, new Proxy({}, { has() { b6.v = 6; return true; } })));
function acrossLength(a, f) { let n = 0; for (let i = 0; i < a.length; i++) { n += a[i]; f(a, i); } return n; }
console.log(acrossLength([1, 2, 3], (a, i) => { if (i === 0) a.length = 2; }), acrossLength([1, 2], (a, i) => { if (i < 2) a.push(1); }));
function acrossSpread(b, it) { const x = b.v; const s = [...it]; return [x, s.length, b.v].join(); }
const b7 = new Box(1); console.log(acrossSpread(b7, { *[Symbol.iterator]() { b7.v = 7; yield 1; } }));
function acrossJSON(b, o) { const x = b.v; JSON.stringify(o); return x + b.v; }
const b8 = new Box(1); console.log(acrossJSON(b8, { toJSON() { b8.v = 8; } }));
function acrossAwait(b) { return (async () => { const x = b.v; await null; return x + b.v; })(); }
const b9 = new Box(1); acrossAwait(b9).then(v => console.log("await", v)); b9.v = 9;
function acrossInstanceof(b, C) { const x = b.v; const s = b instanceof C; return [x, s, b.v].join(); }
const b10 = new Box(1); console.log(acrossInstanceof(b10, { [Symbol.hasInstance]() { b10.v = 0; return false; } }));
function acrossSort(a) { const first = a[0]; a.sort((p, q) => q - p); return first + a[0]; } console.log(acrossSort([1, 5, 3]));
function ident() { const a = { k: 1 }, b = { k: 1 }; return [a === b, a === a, [a].includes(a), [a].includes(b), new Set([a, b, a]).size].join(); } console.log(ident());
function pick(c) { const o = c ? { t: 1 } : { t: 2 }; const p = o; p.t += 10; return o.t; } console.log(pick(true), pick(false));
function loopAlloc() { let prev = null, same = 0; for (let i = 0; i < 3; i++) { const o = { i }; if (o === prev) same++; prev = o; } return same + ":" + prev.i; } console.log(loopAlloc());
function maybeEscape(c) { const o = { v: 1 }; if (c) sink.push(o); o.v++; return o.v; } const sink = []; console.log(maybeEscape(false), maybeEscape(true), sink[0].v);
function frozenLit() { const o = Object.freeze({ v: 1 }); try { (() => { "use strict"; o.v = 2; })(); } catch (e) { return e.name + o.v; } return o.v; } console.log(frozenLit());
function keyOrder() { const o = { b: 1 }; o.a = 2; o[1] = 3; delete o.b; o.b = 4; return Object.keys(o).join(); } console.log(keyOrder());
function weak() { const k = {}; const w = new WeakMap([[k, 1]]); return w.get(k) + (w.has({}) ? 1 : 0); } console.log(weak());
