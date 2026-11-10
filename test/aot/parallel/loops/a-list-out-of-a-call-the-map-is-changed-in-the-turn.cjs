// STATISTIC: LoopsBuiltTwice >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
const m = new Map();
function fresh() { const made = []; for (let i = 0; i < 8; i++) made.push(i + 0.5); m.set('rows', made); return made; }
const odd = { at: -1, valueOf() { if (this.at === 0) m.set('rows', [100.5, 200.5, 300.5, q]); if (this.at === 1) m.get('rows').length = 3; if (this.at === 2) m.delete('rows'); if (this.at === 3) m.clear(); if (this.at === 4) m.set('rows', 'ab' + q); return 7; } };
function f(t) { let s = t & 1; for (let i = 0; i < m.get('rows').length; i++) s = s + m.get('rows')[i] * 2; return s; }
function tried(t) { try { return f(t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
fresh(); const said = []; for (let t = 0; t < 30; t++) tried(t);
for (let at = 0; at < 5; at++) { fresh()[1] = odd; odd.at = at; said.push(tried(0)); odd.at = -1; said.push(tried(1)); } console.log(said.join());
