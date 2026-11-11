// STATISTIC: ArraySpeculationsWithTypedArrayFallback >= 1
"use strict";
function turned(V, j) { j = j | 0; let h = 0; for (let k = 0; k < V.length; k++) { h = V[k][j + 1]; V[k][j + 1] = 0.6 * V[k][j] + 0.8 * h; V[k][j] = 0.8 * V[k][j] - 0.6 * h; } return h; }
const go = { turned }[JSON.parse('"turned"')];
const V = Array.from({ length: 6 }, (_, i) => Float64Array.from({ length: 4 }, (_, j) => i + j / 2));
const said = [go(V, JSON.parse("1")), go(V, JSON.parse("2")), go(V, JSON.parse("3"))];
V[2] = [1.5, 2.5, 3.5, 4.5]; said.push(go(V, JSON.parse("0")), Array.from(V[2]).join(), Array.from(V[5]).join());
console.log(said.join(" | "));
