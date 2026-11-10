'use strict';
const rope = JSON.parse('"co"') + JSON.parse('"nst"');
const subjects = ['const', rope, 'cons', '', 'c', 5, null, undefined, { toString() { return 'const'; } }, new String('const')];
function assigned(x) { let s = 0; for (let i = 0; i < 12; i++) { let d; if (d = x === 'const') s += x.length; else s += 2; s += d ? 10 : 20; } return s; }
function denied(x) { let s = 0, d; if (!(d = x === 'const')) s += 2; else s += x.length; return s + (d ? 10 : 20); }
function looped(x, m) { let s = 0; for (let i = 0; i < m; i++) { let d, k = 0; while ((d = x === 'const') && k < 2) { s += x.length; k++; } s += d ? 10 : 20; } return s; }
function chosen(x) { let d; const s = (d = 'const' === x) ? x.length : 3; return s + (d ? 10 : 20); }
globalThis.kept = [assigned, denied, looped, chosen];
for (const f of globalThis.kept) console.log(f.name, subjects.map(x => { try { return f(x, 3); } catch (e) { return e.constructor.name; } }).join());
