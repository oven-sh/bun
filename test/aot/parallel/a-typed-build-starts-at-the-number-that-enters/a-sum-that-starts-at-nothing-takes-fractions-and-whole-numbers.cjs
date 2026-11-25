"use strict";
// What goes round starts as a whole number and takes fractions.
const rows = JSON.parse('[[4,1.5],[2,2],[9.25,0],[1,7]]');
function nearest(all, scale) {
    let sum = 0;
    for (const row of all) { for (let k = 0; k < row.length; k++) sum = sum + row[k] * scale[k] - scale[k] * scale[k]; }
    return sum;
}
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 24; turn++) printed.push(String(ops[steps[0]](rows, rows[turn & 3])));
console.log(printed.join(" "));
