"use strict";
const list = JSON.parse("[3,1,4,1,5,9,2,6]"), m = new Float32Array([2, 1]), out = new Float32Array(1);
function scale(out, a, m) { out[0] = a * m[0] + m[1]; return out; }
const half = JSON.parse("0.5");
function run(t, list) { const step = t & 1 ? 1 : half; let s = 0; for (let i = 0; i < list.length; i++) { scale(out, list[(i + step) % list.length], m); s += out[0] === out[0] ? out[0] : 1000; } return s; }
const n = 5; let all = 0; for (let t = 0; t < n; t++) all = (all + run(t, list)) % 1000003; console.log(all);
