// STATISTIC: ListsKeptAtHeadsThoughAnAnswerAboutThemWasForgotten >= 1
"use strict";
// What the literals are born with differs; each is read by the kind it was born with, in the typed copies and in the one that claims nothing.
const rows = JSON.parse('[[1,2,3],[4.5,5,6],[7,8,9.25],"xyz",[10,11,12]]');
function weigh(all, a, b, c) {
    const whole = [a | 0, b | 0, c | 0], parts = [a + 0.5, b + 0.25, c + 0.125];
    let sum = 0;
    for (const row of all) {
        for (let k = 0; k < whole.length; k++) sum += (row[k] * whole[k] + parts[k] * whole[k]) || 1;
    }
    return sum;
}
const ops = { weigh, idle() { return 0; } }, steps = JSON.parse('["weigh"]');
let printed = 0;
for (let turn = 0; turn < 40; turn++) printed += ops[steps[0]](rows, turn, turn * 3, turn * 7);
console.log(printed);
