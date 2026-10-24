// Environments: captured variables shared, mutated after capture, per-iteration bindings, TDZ, recursion, re-entrancy.
function counter() { let n = 0; return { inc() { return ++n; }, get() { return n; }, reset() { n = "zero"; } }; }
const c1 = counter(), c2 = counter(); c1.inc(); c1.inc(); c2.inc(); console.log(c1.get(), c2.get()); c1.reset(); console.log(c1.inc(), c1.get(), c2.get());
const fs = []; for (let i = 0; i < 3; i++) { fs.push(() => i); i += 0; } console.log(fs.map(f => f()).join());
const gs = []; for (let i = 0; i < 3; i++) { gs.push(() => i++); } console.log(gs.map(f => f()).join(), gs.map(f => f()).join());
var hs = []; for (var v = 0; v < 3; v++) hs.push(() => v); console.log(hs.map(f => f()).join());
function tdz() { try { const f = () => x; f(); let x = 1; return x; } catch (e) { return e.name; } } console.log(tdz());
function tdz2(flag) { const read = () => y; if (flag) { try { return read(); } catch (e) { return e.name; } } let y = 5; return read(); } console.log(tdz2(true), tdz2(false));
function rec(n, acc) { let mine = n; acc.push(() => mine); if (n) rec(n - 1, acc); mine += 10; return acc; } console.log(rec(3, []).map(f => f()).join());
let top = 1; function bump() { top++; } function readTwice() { const a = top; bump(); return a + top; } console.log(readTwice(), top);
let modVar = 0; const setLater = v => { modVar = v; }; setTimeout(() => { setLater("late"); console.log("timer", modVar, typeof modVar); }, 0); console.log(modVar + 1);
function shared() { let s = 0; const add = k => { s += k; }; [1, 2, 3].forEach(add); return s; } console.log(shared());
function param(a) { const set = () => { a = "set"; }; const before = a; set(); return before + a; } console.log(param(1));
function args(a) { const g = () => arguments[0]; a = 2; return g(); } console.log(args(1));
function* g2() { let k = 0; const f = () => k; while (k < 3) { k++; yield f; } } console.log([...g2()].map(f => f()).join());
async function a2() { let k = 0; const f = () => k; k++; await 0; k++; return f(); } a2().then(v => console.log("async", v));
function sw(x) { switch (x) { case 1: let q = "one"; return () => q; default: try { return q; } catch (e) { return () => e.name; } } } console.log(sw(1)(), sw(2)());
function catchVar() { const out = []; for (const t of [1, 2]) { try { throw t; } catch (e) { out.push(() => e); } } return out.map(f => f()).join(); } console.log(catchVar());
function named() { const f = function self(n) { return n ? self(n - 1) + 1 : 0; }; return f(3); } console.log(named());
function defaults(a, b = () => a) { var a = 5; return [a, b()].join(); } console.log(defaults(1));
function blockFn() { const r = []; for (let i = 0; i < 2; i++) { function inner() { return i; } r.push(inner); } return r.map(f => f()).join(); } console.log(blockFn());
let reent = 0; function re(n) { const my = ++reent; if (n) re(n - 1); return my === reent ? "same" : "differs:" + my + ":" + reent; } console.log(re(2));
const obj = { v: 1, m() { return () => this.v; } }; const arrow = obj.m(); obj.v = 2; console.log(arrow(), obj.m.call({ v: 9 })());
