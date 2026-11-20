// STATISTIC: TypedArrayRowStoreRegionsGuarded >= 1
"use strict";
const said = [];
const hidden = (value) => ({ value })[JSON.parse('"value"')];
function pour(rows, at) { at = at | 0; let held = 0; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = rows[k][at] * 0.6 + held / 2; rows[k][at] = (held - rows[k][at]) * 0.8; } return held; }
const go = hidden(pour);
const show = (cups) => cups.map((row) => Array.from(row ?? [], (x) => String(x)).join()).join(";");
const cups = [Float64Array.of(1, 2, 3), [1, 2, 3], Float64Array.of(4, 5, 6), [4.5, 5.5, 6.5], Float32Array.of(7, 8, 9)];
said.push(go(cups, hidden(0)), go(cups, hidden(1)), go(cups, hidden(2)), show(cups));
console.log(said.join(" | "));
