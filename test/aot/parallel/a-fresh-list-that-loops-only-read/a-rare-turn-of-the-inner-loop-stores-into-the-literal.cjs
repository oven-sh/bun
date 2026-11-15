"use strict";
// One turn in many lays another row into the list that the turns read.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5],[4.75,0.25],[2.5,2.5],[0.25,4.5],[3.75,1.25]]');
function nearest(all, shift, rare) {
    const marks = [all[shift % 8], all[(shift + 3) % 8], all[(shift + 5) % 8]];
    let sum = 0, count = 0;
    for (const spot of all) {
        for (let m = 0; m < marks.length; m++) {
            const across = spot[0] - marks[m][0];
            if (++count === rare) marks[m] = all[(shift + 1) % 8];
            const up = spot[1] - marks[m][1];
            sum = (sum * 5 + across * 8 + up * 8) % 1000003;
        }
    }
    return sum;
}
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 30; turn++) printed.push(ops[steps[0]](spots, turn, turn % 24));
console.log(printed.join(" "));
