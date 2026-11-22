"use strict";
function poured(into, from, shares, many, by) { for (let low = 0, k = 0; low < many; low += 2, k += by) { const high = low + many, share = shares[k] - shares[k + 1] / 2; into[high] = from[low] - from[high + 1] * share; into[low + 1] = from[high] + share; into[low] = (from[low + 1] + share) / 2; into[high + 1] = share * 3 - from[low]; } return into[1] + into[many]; }
const many = 32, from = new Array(many * 2), into = new Array(many * 2), shares = new Array(many * 2);
for (let i = 0; i < many * 2; i++) { from[i] = i * 0.5 + 0.25; into[i] = 0.5; shares[i] = Math.cos(i) + 0.001; }
const n = 5; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + poured(into, from, shares, many, 2)) % 1000003; console.log(Math.floor(sum * 1000));
