"use strict";
function mix(out, data, table, size, step) { for (let i = 0, k = 0; i < size; i += 2, k += step) { const a = i, b = a + size; const ar = data[a], ai = data[a + 1], br = data[b], bi = data[b + 1]; const tr = table[k], ti = table[k + 1]; const mr = br * tr - bi * ti, mi = br * ti + bi * tr; out[a] = ar + mr; out[a + 1] = ai + mi; out[b] = ar - mr; out[b + 1] = ai - mi; } return out[1] + out[size]; }
const size = 32, data = new Array(size * 2), out = new Array(size * 2), table = new Array(size * 2);
for (let i = 0; i < size * 2; i++) { data[i] = i * 0.5 + 0.25; out[i] = 0.5; table[i] = Math.cos(i) + 0.001; }
const n = 5; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + mix(out, data, table, size, 2)) % 1000003; console.log(Math.floor(sum * 1000));
