'use strict';
const L = []; for (let i = 0; i < 8; i++) { L[i] = []; for (let j = 0; j < 64; j++) L[i].push(i * 8 + j); }
const w = JSON.parse('[5]')[0];
function make(c) { return [(p, i) => p + i > c + 990, (p, i) => p + i > c + 991, (p, i) => p + i > c + 992, (p, i) => p + i > c + 993, (p, i) => p + i > c + 994, (p, i) => p + i > c + 995]; }
const G = make(w)[w];
function f(t) { let u = t & 1; if (L[t & 7].some(G)) u++; return u; }
const n = +(process.argv[2] || 300); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(sum);
