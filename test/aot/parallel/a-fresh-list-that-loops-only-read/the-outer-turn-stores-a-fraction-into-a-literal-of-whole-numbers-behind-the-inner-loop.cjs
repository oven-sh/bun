"use strict";
// The inner loop only reads the literal; the outer turn stores into it behind that loop, and the kind of its storage changes with the first fraction.
const rows = JSON.parse('[[1,2,3],[4,5,6],[7,8,9],[10,11,12]]');
function weigh(all, a, part) {
    const weights = [a | 0, (a + 1) | 0, (a + 2) | 0];
    let sum = 0, turn = 0;
    for (const row of all) {
        for (let k = 0; k < weights.length; k++) sum += row[k] * weights[k] + weights[k];
        weights[turn++ % 3] = part;
    }
    return sum;
}
const ops = { weigh, idle() { return 0; } }, steps = JSON.parse('["weigh"]'), parts = JSON.parse('[0.5, 3, "4", null]');
const printed = [];
for (let turn = 0; turn < 24; turn++) printed.push(ops[steps[0]](rows, turn, parts[turn & 3]));
console.log(printed.join(" "));
