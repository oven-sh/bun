// Natives that construct a class of the program and fill what it made.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const seen = [];
class C { constructor(n) { this.cn = { qe: n }; } }
const a = Array.from.call(C, [10, 20]); console.log(a instanceof C, attempt(() => a.cn.qe), a.length, a[0]);
const b = Array.of.call(C, 1, 2, 3); console.log(b instanceof C, attempt(() => b.cn.qe), b.length);
class L { length = { qe: 1 }; }
const c = Array.from.call(L, [1]); console.log(attempt(() => c.length.qe), typeof c.length);
const d = Array.of.call(L, 1); console.log(attempt(() => d.length.qe), typeof d.length);
console.log(attempt(() => new L().length.qe));
class S extends Array { extra = { qe: 5 }; static get [Symbol.species]() { return T; } }
class T { constructor(n) { this.tn = { qe: n }; } length = { qe: 6 }; }
const s = new S(); s.push(1, 2);
const m = attempt(() => s.map(v => v)); console.log(m instanceof T, attempt(() => m.length.qe), attempt(() => m.tn.qe), attempt(() => m[0]));
const fl = attempt(() => s.filter(v => true)); console.log(fl instanceof T, attempt(() => fl.length.qe), attempt(() => fl[1]));
const sl = attempt(() => s.slice(0)); console.log(sl instanceof T, attempt(() => sl.length.qe), typeof sl.length);
const sp = attempt(() => s.splice(0, 1)); console.log(sp instanceof T, attempt(() => sp.length.qe), typeof sp.length);
const cc = attempt(() => s.concat([3])); console.log(cc instanceof T, attempt(() => cc.length.qe), typeof cc.length);
console.log(attempt(() => new T(1).length.qe));
