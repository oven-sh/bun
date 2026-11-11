"use strict";
const rows = JSON.parse("[[1,2,3],[4,5,6],[7,8,9],[1,1,1],[2,0,2]]"), m = new Float32Array([1, 2, 3, 4]), out = new Float32Array(3);
function mix(out, a, m) { out[0] = a[0] * m[0] + a[1] * m[1]; out[1] = a[1] * m[2]; out[2] = a[2] * m[3]; return out; }
function run(t, rows) { let s = 0; for (let i = 0; i < rows.length; i++) { mix(out, rows[(i + 1) % rows.length], m); s += out[0]; } return s; }
const like = { length: 2, 0: [5, 5, 5], 1: [6, 6, 6] };
const n = 5; let all = 0; for (let t = 0; t < n; t++) all = (all + run(t, t % 3 === 2 ? like : rows)) % 1000003; console.log(all);
