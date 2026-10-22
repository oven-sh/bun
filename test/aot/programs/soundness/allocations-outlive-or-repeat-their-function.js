// "Runs at most once", "stored once", frame allocation, closures kept by hosts and generators.
let made = 0;
function once() { made++; const state = { n: made, list: [] }; return () => { state.list.push(state.n); return state; }; }
const fs = []; function callTwice(f) { fs.push(f()); fs.push(f()); } callTwice(once);
console.log(fs[0]() === fs[1](), fs[0]().n, fs[1]().n, fs[0]().list.length);
function point(x, y) { return { x, y }; }
function keep() { const p = point(1, 2); const q = point(3, 4); holder.push(q); return p.x + q.y; }
const holder = []; console.log(keep(), keep(), holder[0] === holder[1], holder[0].x, holder.length);
function* gen() { const local = { v: 1 }; yield local; local.v++; yield local; }
const it = gen(); const a = it.next().value; const b = it.next().value; console.log(a === b, a.v);
async function as() { const local = [1]; await null; local.push(2); return local; }
as().then(v => console.log("async", v.join()));
let single; function init(fail) { if (single) return single; const o = { ready: false, tries: (init.t = (init.t | 0) + 1) }; if (fail) throw new Error("no"); o.ready = true; single = o; return o; }
try { init(true); } catch (e) { console.log(e.message); } console.log(init(false).tries, init(false) === single);
function rec(n) { const frame = { n }; if (n) { const inner = rec(n - 1); return inner.n + frame.n ? frame : inner; } return frame; } console.log(rec(3).n);
const objs = []; for (let i = 0; i < 3; i++) { const o = { i }; objs.push(() => o); } console.log(objs.map(f => f().i).join(), objs[0]() === objs[1]());
function leak() { const t = { secret: 1 }; try { throw t; } catch (e) { return e; } } console.log(leak().secret, leak() === leak());
function viaThis() { const o = { me() { return this; } }; return o.me(); } console.log(typeof viaThis().me);
function viaArgs() { const o = { k: 1 }; return (function () { return arguments; })(o); } console.log(viaArgs()[0].k);
function viaGetter() { const inner = { k: 2 }; return { get g() { return inner; } }; } const vg = viaGetter(); console.log(vg.g === vg.g, vg.g.k);
function viaMap() { const k = {}; const m = new Map([[k, 1]]); return m; } console.log([...viaMap().keys()].length);
function viaSort() { const a = [{ v: 2 }, { v: 1 }]; let kept; a.sort((p, q) => { kept = p; return p.v - q.v; }); return kept; } console.log(typeof viaSort().v);
class Counter { static n = 0; id = ++Counter.n; } console.log(new Counter().id, new Counter().id, Counter.n);
