// STATISTIC: RowsThatAreNoListsAskedForViews >= 1
"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function run(V, j) { j = j | 0; let h = 0; for (let k = 0; k < V.length; k++) { h = V[k][j + 1]; V[k][j + 1] = 0.6 * V[k][j] + 0.8 * h; V[k][j] = 0.8 * V[k][j] - 0.6 * h; } return h; }
const go = hidden(run);
const show = (V) => V.map((row) => Array.from(row ?? [], (x) => String(x)).join()).join(";");
const V = [Float64Array.of(1, 2, 3), [1, 2, 3], Float64Array.of(4, 5, 6), [4.5, 5.5, 6.5], Float32Array.of(7, 8, 9)];
said.push(go(V, hidden(0)), go(V, hidden(1)), go(V, hidden(2)), show(V));
console.log(said.join(" | "));
