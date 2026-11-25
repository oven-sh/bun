"use strict";
const list = JSON.parse("[3,1,4,1,5,9,2,6]"), m = new Float32Array([2, 1]), out = new Float32Array(1);
function scale(out, a, m) { out[0] = a * m[0] + m[1]; return out; }
function run(t, list) { let s = 0; for (let i = 0; i < list.length; i++) { list[(i - 1) % list.length] = i * 0.5; scale(out, list[(i - 1) % list.length], m); s += out[0] === out[0] ? out[0] : 1000; } return s; }
const n = 5; let all = 0; for (let t = 0; t < n; t++) all = (all + run(t, list)) % 1000003; console.log(all);
