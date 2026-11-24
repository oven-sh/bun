"use strict";
const rows = JSON.parse("[[1,2,3],[4,5,6],[7,8,9],[1,1,1],[2,0,2]]"), doses = new Float32Array([1, 2, 3, 4]), jars = new Float32Array(3);
function pour(jars, row, doses) { jars[2] = row[2] * doses[3]; jars[0] = row[1] * doses[1] + row[0] * doses[0]; jars[1] = doses[2] * row[1]; return jars; }
const other = new Float32Array([9, 9, 9, 9]); let now = doses;
function run(t, rows) { let s = 0; for (let i = 0; i < rows.length; i++) { pour(jars, rows[(i + 1) % rows.length], now); s += jars[0]; if (i === 1) now = now === doses ? other : doses; } return s; }
const n = 5; let all = 0; for (let t = 0; t < n; t++) all = (all + run(t, rows)) % 1000003; console.log(all);
