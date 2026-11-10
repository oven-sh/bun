// STATISTIC: TypedArrayRowsGuardedInIterations >= 1
"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function run(V, j) { j = j | 0; let s = 0; for (let k = 0; k < V.length; k++) s += V[k][j]; return s; }
const go = { run }[JSON.parse('"run"')];
const bytes = new Uint8Array(16).fill(255); const odd = new Float64Array(bytes.buffer);
const V = [Float64Array.of(1.5, 2.5), Float64Array.of(3.5, 4.5), odd, Float64Array.of(5.5, 6.5)];
for (const j of [0, 1]) { const s = go(V, hidden(j)); said.push(typeof s, Object.is(s, NaN), String(s), JSON.stringify([s]), [s].includes(NaN)); }
V.splice(2, 1); said.push(go(V, hidden(1)));
console.log(said.join(" | "));
