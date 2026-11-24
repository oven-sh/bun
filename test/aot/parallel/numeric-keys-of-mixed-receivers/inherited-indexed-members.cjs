// Holder: classbase
const later = [];
const show = (v) => typeof v === 'function' ? 'function' : typeof v === 'symbol' || typeof v === 'bigint' ? String(v) : typeof v === 'object' && v !== null ? JSON.stringify(v, (k, x) => typeof x === 'bigint' ? String(x) : x) : typeof v + ':' + String(v);
class B { 2() { return 'b'; } get 0() { return 'g' + this.a; } } class C extends B { constructor() { super(); this.a = 1; } } const h = new C();
function read(o, n) { const out = []; for (let i = 0; i < n; i++) out.push(show(o[i])); return out.join(' '); }
function sum(o, n) { let s = 0; for (let i = 0; i < n; i++) if (typeof o[i] === 'number') s += o[i]; else if (o[i] !== undefined && o[i] !== null) s += 1000; return s; }
function at(o, k) { return show(o[k]); }
for (const k of [0, 1, 2, -1, 1.5, NaN, Infinity, 1e21]) console.log(String(k), at(h, k));
console.log(read(h, 4)); console.log(sum(h, 4));
for (const f of later) f();
console.log(read(h, 4)); console.log(sum(h, 4)); console.log(at(h, later.length));
