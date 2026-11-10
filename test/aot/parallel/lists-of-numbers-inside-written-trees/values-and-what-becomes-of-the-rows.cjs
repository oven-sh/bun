"use strict";
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const show = (value) => JSON.stringify(value, (key, each) => (typeof each === "number" && !Number.isFinite(each) ? String(each) : Object.is(each, -0) ? "-0" : each));
const WHOLE = [[0, 1, 0], [1, -4, 1], [2147483647, -2147483648]];
const FRACTIONS = [[0.5, 1], [2, 3.5], [2147483648, 1], [1e300, -1.25]];
const ODD = [[-0, 1], [NaN, 2], [Infinity, 3], [1, , 3], [1, undefined], [1, null], [1, "two"], [], [true, 1]];
const HELD = { row: [1, 2, 3], deeper: { row: [0.25, 4] }, rows: [[1], [2.5]] };
console.log(show(WHOLE), show(FRACTIONS), show(ODD), show(HELD));
console.log(1 in ODD[3], ODD[3].length, Object.is(ODD[0][0], -0), Number.isNaN(ODD[1][0]));
function sumOfRows(rows) { let s = 0; for (let r = 0; r < rows.length; r++) for (let i = 0; i < rows[r].length; i++) s += rows[r][i] * 2; return s; }
console.log(unseen(sumOfRows)(WHOLE), unseen(sumOfRows)(FRACTIONS), unseen(sumOfRows)(HELD.rows));
WHOLE[0][1] = 0.5; WHOLE[1].push("text"); WHOLE[2][5] = 7; delete FRACTIONS[0][0]; FRACTIONS[1][0] = { a: 1 }; FRACTIONS[2].length = 0; FRACTIONS[3][1] = NaN; HELD.row.unshift(-0); Object.freeze(HELD.deeper.row);
console.log(show(WHOLE), show(FRACTIONS), show(HELD), 3 in WHOLE[2], 0 in FRACTIONS[0], Number.isNaN(FRACTIONS[3][1]));
console.log(unseen(sumOfRows)([WHOLE[0], WHOLE[2].slice(0, 2), FRACTIONS[3]]));
function make(t) { return [[t & 0, 1, 2], [3, 4.5], { row: [5, 6] }]; }
function fresh() { return [[1, 2, 3], [4.5, 6], { row: [7, 8] }]; }
const first = unseen(fresh)(), second = unseen(fresh)(); first[0][0] = 100; first[1][0] = "x"; first[2].row.push(9);
console.log(show(first), show(second), first[0] === second[0], show(unseen(make)(5)));
let all = 0; for (let t = 0; t < 50; t++) { const made = fresh(); made[0][t % 3] += t; all += made[0][0] + made[0][1] + made[0][2] + made[1][0] + made[2].row[1]; }
console.log(all);
