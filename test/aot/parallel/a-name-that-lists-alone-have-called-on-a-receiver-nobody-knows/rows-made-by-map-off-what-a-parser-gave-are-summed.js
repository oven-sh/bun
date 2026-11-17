"use strict";
const D = JSON.parse(process.argv[2] || "[[1,2,3],[4,5,6],[7,8,9]]");
const V = D.map((r, i) => Float64Array.from(r));
function sum(V) { let s = 0; for (let i = 0; i < V.length; i++) { const row = V[i]; for (let j = 0; j < row.length; j++) s += row[j]; } return s; }
let all = 0;
for (let t = 0; t < 40; t++) all += sum(V);
console.log(all);
