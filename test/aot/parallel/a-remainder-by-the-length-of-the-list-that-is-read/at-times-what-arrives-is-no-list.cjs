"use strict";
const rows = JSON.parse("[[1,2,3],[4,5,6],[7,8,9],[1,1,1],[2,0,2]]"), doses = new Float32Array([1, 2, 3, 4]), jars = new Float32Array(3);
function mix(sums, left, times) { sums[1] = times[2] * left[1]; sums[2] = times[3] * left[2]; sums[0] = left[0] * times[0] + left[1] * times[1]; return sums; }
function run(t, rows) { let s = 0; for (let i = 0; i < rows.length; i++) { mix(jars, rows[(i + 1) % rows.length], doses); s += jars[0]; } return s; }
const like = { length: 2, 0: [5, 5, 5], 1: [6, 6, 6] };
const n = 5; let all = 0; for (let t = 0; t < n; t++) all = (all + run(t, t % 3 === 2 ? like : rows)) % 1000003; console.log(all);
