// Functions, classes and literals that stand once in the text and are evaluated several times by callbacks.
const log = (...a) => console.log(a.map(String).join(" "));
function make1() { class K { static n = 0; m() { return ++K.n; } } return K; } const [K1a, K1b] = [0, 0].map(make1); log(1, K1a === K1b, new K1a().m(), new K1a().m(), new K1b().m(), new K1a() instanceof K1b);
function once2() { let c = 0; return () => ++c; } const fs2 = Array.from({ length: 2 }, once2); log(2, fs2[0](), fs2[0](), fs2[1]());
function once3() { const o = { n: 0 }; return o; } const os3 = JSON.parse("[1,2]", (k, v) => typeof v === "number" ? once3() : v); os3[0].n = 5; log(3, os3[0].n, os3[1].n, os3[0] === os3[1]);
function* gen4() { const o = { n: 0 }; while (true) { o.n++; yield o; } } const g4a = gen4(), g4b = gen4(); g4a.next(); g4a.next(); log(4, g4a.next().value.n, g4b.next().value.n);
let count5 = 0; function rec5(n) { const local = { id: ++count5 }; if (n > 0) [n].forEach(x => rec5(x - 1)); return local.id; } log(5, rec5(3), count5);
function once6() { var x; if (x === undefined) x = 0; x++; return x; } log(6, once6(), setTimeout(() => log(6, once6()), 0) !== null);
const h7 = { get v() { const a = []; a.push(1); return a; } }; const a7 = h7.v; a7.push(2); log(7, h7.v.length, a7.length);
function tag8(s) { return s; } function t8() { return tag8`x`; } log(8, t8() === t8(), [0, 0].map(t8).every((s, i, a) => s === a[0]));
function once9() { return /a/g; } const r9 = once9(); r9.lastIndex = 5; log(9, once9().lastIndex, r9 === once9());
async function a10(i) { const box = { i }; await null; return box; } Promise.all([a10(1), a10(2)]).then(([x, y]) => log(10, x.i, y.i, x === y));

function ctor12() { this.list = []; } const i12 = [new ctor12(), Reflect.construct(ctor12, []), new (ctor12.bind(null))()]; i12[0].list.push(1); log(12, i12.map(o => o.list.length).join());
class C13 { static list = []; static { C13.list.push("init"); } } log(13, C13.list.join());
function outer14() { function inner() { return inner.calls = (inner.calls || 0) + 1; } return inner; } const [i14a, i14b] = [outer14(), outer14.call()]; i14a(); log(14, i14a(), i14b(), i14a === i14b);
let lazy15; function get15() { return lazy15 ??= { made: ++count15 }; } var count15 = 0; log(15, get15().made, get15().made, [1].map(get15)[0].made);
for (let i = 0; i < 2; i++) { class L16 { static i = i; } globalThis["L16_" + i] = L16; } log(16, L16_0.i, L16_1.i, L16_0 === L16_1);
const fns17 = []; for (let i = 0; i < 3; i++) fns17.push(() => i); log(17, fns17.map(f => f()).join()); const fns17b = []; for (var j = 0; j < 3; j++) fns17b.push(() => j); log(17, fns17b.map(f => f()).join());
function def18(a = [], b = { n: 0 }) { a.push(1); b.n++; return a.length + b.n; } log(18, def18(), def18(), [undefined].map(x => def18(x)).join());
label19: { const sym = () => Symbol("s"); log(19, sym() === sym(), [0, 0].map(sym).reduce((a, b) => a === b)); }
function once20() { try { throw { n: 1 }; } catch (e) { return e; } } const e20 = once20(); e20.n = 2; log(20, once20().n);
