"use strict";
const rows = JSON.parse("[[1,2,3],[4,5,6],[7,8,9],[1,1,1],[2,0,2]]"), m = new Float32Array([1, 2, 3, 4]), out = new Float32Array(3);
function mix(out, a, m) { out[0] = a[0] * m[0] + a[1] * m[1]; out[1] = a[1] * m[2]; out[2] = a[2] * m[3]; return out; }
const other = new Float32Array([9, 9, 9, 9]); let now = m;
function run(t, rows) { let s = 0; for (let i = 0; i < rows.length; i++) { mix(out, rows[(i + 1) % rows.length], now); s += out[0]; if (i === 1) now = now === m ? other : m; } return s; }
const n = 5; let all = 0; for (let t = 0; t < n; t++) all = (all + run(t, rows)) % 1000003; console.log(all);
