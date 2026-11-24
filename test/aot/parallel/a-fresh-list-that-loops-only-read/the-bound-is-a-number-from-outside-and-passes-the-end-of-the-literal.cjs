// STATISTIC: FreshArrayElementReadsEliminated >= 1
"use strict";
// The bound says nothing of the list: a read may find nothing. What the first read found, or did not find, answers the second as long as nothing is written.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5],[4.75,0.25],[2.5,2.5],[0.25,4.5],[3.75,1.25]]');
function reach(all, shift, bound) {
    const marks = [all[shift % 8], all[(shift + 3) % 8], all[(shift + 5) % 8]];
    let sum = 0;
    for (const spot of all) {
        for (let m = 0; m < bound; m++) {
            const first = marks[m] === undefined ? -1 : marks[m][0], second = marks[m] === undefined ? -2 : marks[m][1];
            sum = (sum * 7 + first * 4 + second * 4 + spot[0] * 4) % 1000003;
        }
    }
    return sum;
}
const ops = { reach, idle() { return 0; } }, steps = JSON.parse('["reach"]'), bounds = JSON.parse('[3, 5, 0, 4]');
let printed = 0;
for (let turn = 0; turn < 40; turn++) printed = (printed + ops[steps[0]](spots, turn, bounds[turn & 3])) % 1000003;
console.log(printed);
