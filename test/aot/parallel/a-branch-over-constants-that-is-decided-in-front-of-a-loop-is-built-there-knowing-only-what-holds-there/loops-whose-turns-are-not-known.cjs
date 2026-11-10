'use strict';
process.env.TGM_SET = 'debug'; delete process.env.TGM_UNSET;
const D = JSON.parse('{"workers":"4","quiet":""}');
function chain(n) { let at; for (let i = 0; i < n; i++) at = { weight: i + 1, above: at }; return at; }
function counted(m) { let s = 0; for (let i = 0; i < m; i++) s += (process.env.TGM_UNSET || 'info').length + (process.env.TGM_SET || 'info').length * 10 + (D.workers ? 400 : 100) + (D.quiet ? 8000 : 2000); return s; }
function climbed(at) { let s = 0; while (at) { s += ((process.env.TGM_UNSET || 'dev') === 'dev' ? 1 : 2) + at.weight * 10; at = at.above; } return s; }
function nested(m, k) { let s = 0; for (let j = 0; j < m; j++) for (let i = 0; i < k; i++) s += (process.env.TGM_SET || 'info').length + j; return s; }
function left(m, k) { let s = 0; for (let i = 0; i < m; i++) { if (i === k) break; s += (process.env.TGM_UNSET || 'info').length; } return s; }
globalThis.kept = [counted, climbed, nested, left];
console.log([0, 1, 2, 3, 8, 40].map(counted).join(), [0, 1, 2, 3, 8].map(n => climbed(chain(n))).join(), nested(0, 3), nested(3, 0), nested(2, 3), left(0, 0), left(5, 0), left(5, 1), left(5, 9));
