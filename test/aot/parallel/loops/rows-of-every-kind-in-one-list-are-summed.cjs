"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function run(V, j) { j = j | 0; let s = 0; for (let k = 0; k < V.length; k++) s += V[k][j]; return s; }
const go = hidden(run);
const V = [[1.5, 2.5], Float64Array.of(3.5, 4.5), Float32Array.of(0.5, 1.5), Uint8Array.of(7, 8), Int16Array.of(-3, -4), [1, 2], ['a', 'b'], 'xy', Buffer.from([9, 10])];
said.push(go(V, hidden(0)), go(V, hidden(1)), go(V, hidden(2)));
console.log(said.join(" | "));
