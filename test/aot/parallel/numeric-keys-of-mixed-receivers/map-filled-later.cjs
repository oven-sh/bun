// Holder: map-after
const later = [];
const show = (v) => typeof v === 'function' ? 'function' : typeof v === 'symbol' || typeof v === 'bigint' ? String(v) : typeof v === 'object' && v !== null ? JSON.stringify(v, (k, x) => typeof x === 'bigint' ? String(x) : x) : typeof v + ':' + String(v);
const h = new Map(); later.push(() => { h[0] = 'after'; h[1] = 4; });
class Holder { constructor(v) { this.v = v; } rows() { let out = ''; for (let i = 0; i < 3; i++) { const r = this.v[i]; out += typeof r + (r ? show(r) : '') + ','; } return out; } total() { let s = 0; for (let i = 0; i < 3; i++) { const r = this.v[i]; if (typeof r === 'number') s += r; } return s; } }
const all = [new Holder([1, 2, 3]), new Holder(h), new Holder([[4]])];
for (let turn = 0; turn < 2; turn++) { for (const x of all) console.log(x.rows(), x.total()); for (const f of later) f(); }
