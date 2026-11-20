// STATISTIC: ArraySpeculationsWithTypedArrayFallback >= 1
"use strict";
function poured(rows, at) { at = at | 0; let held = 0; for (let k = 0; k < rows.length; k++) { held = rows[k][at + 1]; rows[k][at + 1] = rows[k][at] * 0.6 + held / 2; rows[k][at] = (held - rows[k][at]) * 0.8; } return held; }
const go = { poured }[JSON.parse('"poured"')];
const cups = Array.from({ length: 6 }, (_, i) => Float64Array.from({ length: 4 }, (_, j) => i + j / 2));
const said = [go(cups, JSON.parse("1")), go(cups, JSON.parse("2")), go(cups, JSON.parse("3"))];
cups[2] = [1.5, 2.5, 3.5, 4.5]; said.push(go(cups, JSON.parse("0")), Array.from(cups[2]).join(), Array.from(cups[5]).join());
console.log(said.join(" | "));
