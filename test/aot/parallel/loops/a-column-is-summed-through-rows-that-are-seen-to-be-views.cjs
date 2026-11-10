// STATISTIC: RowsAskedForViewsInTurnsOfTypedCopies >= 1
"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function run(V, j) { j = j | 0; let s = 0; for (let k = 0; k < V.length; k++) s += V[k][j]; return s; }
const go = { run }[JSON.parse('"run"')];
const V = Array.from({ length: 7 }, (_, i) => Float64Array.from({ length: 4 }, (_, j) => i + j / 2));
said.push(go(V, hidden(1)), go(V, hidden(3)), go(V, hidden(4)), go(V, hidden(-1)));
V[3] = [10.5, 20.5, 30.5, 40.5]; said.push(go(V, hidden(1))); V[5] = 'text'; said.push(go(V, hidden(1))); V[5] = Int8Array.of(1, 2, 3, 4); said.push(go(V, hidden(2)));
console.log(said.join(" | "));
