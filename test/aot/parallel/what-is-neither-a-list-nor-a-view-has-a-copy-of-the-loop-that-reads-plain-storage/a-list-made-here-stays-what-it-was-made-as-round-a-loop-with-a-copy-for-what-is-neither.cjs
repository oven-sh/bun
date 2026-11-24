// STATISTIC: FreshArrayElementReadsEliminated >= 1
"use strict";
// The list of three rows is made here and the loops only read it. The loop inside is told apart for lists and views over the weights, and one copy more is begun for what is neither.
// Every copy, the closed one among them, begins with what was known at the end of the tests in front: a copy that began knowing nothing took the list from all of them where they meet behind the loop.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5],[4.75,0.25],[2.5,2.5],[0.25,4.5],[3.75,1.25]]');
function nearest(all, shift, weights) {
    const marks = [all[shift % 8], all[(shift + 3) % 8], all[(shift + 5) % 8]];
    let sum = 0;
    for (let round = 0; round < 8; round++) {
        const across = marks[round % 3][0], up = marks[round % 3][1];
        let which = 0;
        for (let m = 0; m < weights.length; m++) which += weights[m] * 2;
        sum = (sum * 3 + which * across + up) % 1000003;
    }
    return sum;
}
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]'), loads = JSON.parse('[[1,2,3,4],[1.5,2.5,3.5],{"0":2,"1":3,"2":4,"length":3}]');
let printed = 0;
for (let turn = 0; turn < 40; turn++) printed = (printed + ops[steps[0]](spots, turn, loads[turn % 3])) % 1000003;
console.log(printed);
