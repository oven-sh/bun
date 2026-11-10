"use strict";
// The list is named by a call in the outer turn: it is no list that the loops only read.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5],[4.75,0.25],[2.5,2.5],[0.25,4.5],[3.75,1.25]]');
const cuts = [list => { list.length = 2; }, list => { list.push(list[0]); }, () => { }];
function nearest(all, shift) {
    const marks = [all[shift % 8], all[(shift + 3) % 8], all[(shift + 5) % 8]];
    let sum = 0, count = 0;
    for (const spot of all) {
        for (let m = 0; m < marks.length; m++) sum = (sum * 5 + (spot[0] - marks[m][0]) * 8 + (spot[1] - marks[m][1]) * 8) % 1000003;
        cuts[(shift + count++) % 3](marks);
    }
    return sum + marks.length;
}
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 30; turn++) printed.push(ops[steps[0]](spots, turn));
console.log(printed.join(" "));
