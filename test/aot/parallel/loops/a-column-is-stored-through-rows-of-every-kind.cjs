// STATISTIC: RowsThatAreNoListsAskedForViews >= 1
"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function run(V, j) { j = j | 0; for (let k = 0; k < V.length; k++) V[k][j] = V[k][j] * 0.5 + 1; return V[V.length - 1][j]; }
const go = hidden(run);
const show = (V) => V.map((row) => Array.from(row ?? [], (x) => String(x)).join()).join(";");
const V = [[1.5, 2.5], Float64Array.of(3.5, 4.5), Float32Array.of(0.5, 1.5), Uint8Array.of(7, 8), Uint8ClampedArray.of(250, 255), Int16Array.of(-3, -4), [1, 2]];
said.push(go(V, hidden(0)), go(V, hidden(1)), go(V, hidden(5)), show(V));
console.log(said.join(" | "));
