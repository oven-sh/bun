// STATISTIC: UnrolledLoopsForIndexingType >= 1
// Under: --aot-check=Validate: the kind that the front has asked is the kind that every read names
// Under: --aot-harden=proof-checks: what the front has asked is asked again of every element
'use strict';
const data = JSON.parse('[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]');
const make = () => [];
const all = []; for (const v of data) { const r = make(); for (let i = 0; i < 8; i++) r[i] = v + i; all.push(r); }
function f(t) { const r = all[t & 7]; let s = 0; for (let i = 0; i < 100; i++) s = (s + r[i & 7]) | 0; return s; }
const n = +process.argv[2] || 3; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
