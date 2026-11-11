"use strict";
// The bound changes while the loop runs.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5],[4.75,0.25],[2.5,2.5]]');
const holders = [JSON.parse('[0,0,0]')];
const cuts = [list => { list.length = 1; }, list => { list.push(0); if (list.length > 3) list.length = 3; }, () => { }];
function nearest(all, shift, measured) {
    const marks = [all[shift % 6], all[(shift + 2) % 6], all[(shift + 5) % 6]];
    let sum = 0, count = 0;
    for (const spot of all) {
        for (let m = 0; m < measured.length; m++) { sum = (sum * 5 + (spot[0] - marks[m][0]) * 8) % 1000003; cuts[(shift + count++) % 3](holders[0]); }
    }
    return sum + ":" + measured.length;
}
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 18; turn++) printed.push(String(ops[steps[0]](spots, turn, holders[turn % holders.length])));
console.log(printed.join(" "));
