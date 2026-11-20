"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function run(V, j, what) { j = j | 0; for (let k = 0; k < V.length; k++) V[k][j] = what; return V[0][j]; }
const go = hidden(run);
const show = (V) => V.map((row) => Array.from(row ?? [], (x) => String(x)).join()).join(";");
let converted = 0; const V = [Float64Array.of(1, 2), [1, 2], Int32Array.of(1, 2)];
said.push(go(V, hidden(0), hidden('7.5')), go(V, hidden(1), hidden({ valueOf() { converted++; return 2.75; } })), converted, go(V, hidden(0), hidden(undefined)), show(V));
try { go(V, hidden(0), hidden(5n)); } catch (error) { said.push(error.constructor === TypeError); }
said.push(show(V));
console.log(said.join(" | "));
