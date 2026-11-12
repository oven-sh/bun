// Holder: protolist
const later = [];
const show = (v) => typeof v === 'function' ? 'function' : typeof v === 'symbol' || typeof v === 'bigint' ? String(v) : typeof v === 'object' && v !== null ? JSON.stringify(v, (k, x) => typeof x === 'bigint' ? String(x) : x) : typeof v + ':' + String(v);
const h = { __proto__: ['l', [2], 7], a: 1 };
const rows = [[1, 2], [3, 4]]; const mixed = [rows, h, rows, h, ['a', { b: 1 }, 3]];
function read(o, n) { let out = ''; for (let i = 0; i < n; i++) { const v = o[i]; out += show(v) + ' '; if (Array.isArray(v)) out += v.length + ' '; else if (v === null) out += 'null '; else if (v === undefined) out += 'none '; else if (typeof v === 'object') out += Object.keys(v).length + ' '; else if (typeof v === 'number') out += (v + 1) + ' '; else if (typeof v === 'string') out += v.length + ' '; } return out; }
function first(d, t) { let s = 0; for (let i = 0; i < 2; i++) { const r = d[i]; if (r) s += r[0] * r[1]; } return String(s + t); }
for (let turn = 0; turn < 3; turn++) { for (const m of mixed) { console.log(read(m, 4)); try { console.log(first(m, turn)); } catch (e) { console.log(e.constructor.name); } } for (const f of later) f(); }
