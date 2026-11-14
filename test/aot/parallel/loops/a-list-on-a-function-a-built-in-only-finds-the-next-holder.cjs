// STATISTIC: SiteCachedReadsHoisted >= 0
'use strict';
const q = Number(process.argv[2] ?? 3);
process.env = { ...process.env, KEPT: 'k' + q };
function kept() { return process.env.KEPT; }
function lacking() { return process.env.NOT_THERE_AT_ALL || 'none'; }
function f(t) { let s = 0; for (let i = 0; i < 20; i++) { s += kept().length + lacking().length; if (t === 30 && i === 9) process.env = { KEPT: 'longer' + q, NOT_THERE_AT_ALL: 'x' }; } return s + (t & 1); }
const said = []; for (let t = 0; t < 40; t++) said.push(f(t)); console.log(said[0], said[30], said[31], said[39]);
