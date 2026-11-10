'use strict';
const rope = JSON.parse('"co"') + JSON.parse('"nst"');
const subjects = ['const', rope, 'cons', 'constant', 'Const', '', 'c', 'cönst', 5, NaN, null, undefined, true, { toString() { return 'const'; } }, ['const'], new String('const'), 5n];
function pick(d) { return d ? 7 : 8; }
function asked(x) { let s = 0; for (let i = 0; i < 12; i++) { const d = x === 'const'; if (d) s += 1; else s += 2; } return s; }
function denied(x) { let s = 0; for (let i = 0; i < 12; i++) { const d = x !== 'const'; if (!d) s += 1; else s += 2; } return s; }
function narrowing(x) { let s = 0; for (let i = 0; i < 12; i++) { const d = x === 'const'; if (d) s += typeof x === 'string' ? x.length : 50; else s += 2; } return s; }
function twice(x) { let s = 0; for (let i = 0; i < 12; i++) { const d = 'const' === x; if (d) s += 1; if (d) s += 10; else s += 20; } return s; }
function chosen(x, m) { let s = 0; for (let i = 0; i < m; i++) { const d = x === 'c', e = x === ''; s += (d ? 3 : 4) + (e ? 30 : 40); } return s; }
function joined(x) { const d = x === 'const', e = x !== 5; let s = 0; if (d && e) s += 1; else s += 2; if (d || x === null) s += 10; return s + +d + pick(d); }
function ordered(x) { let s = 0; for (let i = 0; i < 12; i++) { const d = x < 'const', e = x >= 'd'; if (d) s += 1; if (e) s += 10; } return s; }
function changed(x) { let s = 0; for (let i = 0; i < 12; i++) { let d = x === 'const'; if (i & 1) d = !d; if (d) s += 1; else s += 2; } return s; }
globalThis.kept = [asked, denied, narrowing, twice, chosen, joined, ordered, changed];
for (const f of globalThis.kept) console.log(f.name, subjects.map(x => { try { return f(x, 3); } catch (e) { return e.constructor.name; } }).join());
