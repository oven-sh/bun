// STATISTIC: ArraySpeculationsWithTypedArrayFallback = 0
"use strict";
function poured(rows, at) { at = at | 0; let held = 0; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = rows[k][at] * 0.6 + held / 2; rows[k][at] = (held - rows[k][at]) * 0.8; } return held; }
const go = { poured }[JSON.parse('"poured"')];
const cups = []; for (let i = 0; i < 6; i++) { const row = []; for (let j = 0; j < 4; j++) row.push(i + j / 2); cups.push(row); }
const said = [go(cups, JSON.parse("1")), go(cups, JSON.parse("2")), go(cups, JSON.parse("3")), cups[5].join()];
console.log(said.join(" | "));
