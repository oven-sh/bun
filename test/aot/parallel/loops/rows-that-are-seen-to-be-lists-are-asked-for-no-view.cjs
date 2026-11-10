// STATISTIC: RowsAskedForViewsInTurnsOfTypedCopies = 0
"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function run(V, j) { j = j | 0; let s = 0; for (let k = 0; k < V.length; k++) s += V[k][j]; return s; }
const go = { run }[JSON.parse('"run"')];
const V = Array.from({ length: 7 }, (_, i) => Array.from({ length: 4 }, (_, j) => i + j / 2));
said.push(go(V, hidden(1)), go(V, hidden(3)), go(V, hidden(4)));
console.log(said.join(" | "));
