'use strict';
const L = []; for (let i = 0; i < 8; i++) { L[i] = []; for (let j = 0; j < 64; j++) L[i].push(i * 8 + j); }
const w = JSON.parse('[5]')[0];
const G = [(p, i, l) => p + i > 990 + l.length, (p, i, l) => p + i > 991 + l.length, (p, i, l) => p + i > 992 + l.length, (p, i, l) => p + i > 993 + l.length, (p, i, l) => p + i > 994 + l.length, (p, i, l) => p + i > 995 + l.length][w];
function f(t) { let u = t & 1; if (L[t & 7].some(G)) u++; return u; }
const n = +(process.argv[2] || 300); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(sum);
