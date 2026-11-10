// STATISTIC: HoldersOnlyMeasuredByHeadsGuessedToBeLists >= 1
"use strict";
// None of them is a list: the other copy runs and reads the length as written.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5],[4.75,0.25],[2.5,2.5]]');
const holders = [new Uint8Array(3), (function () { return arguments; })(1, 2), JSON.parse('"abc"'), function (a, b) { }, JSON.parse('{"length":3}'), JSON.parse('[0,0,0]')];
function nearest(all, shift, measured) {
    const marks = [all[shift % 6], all[(shift + 2) % 6], all[(shift + 5) % 6]];
    let sum = 0;
    for (const spot of all) {
        let which = 0, least = Infinity;
        for (let m = 0; m < measured.length; m++) {
            const across = spot[0] - marks[m][0], up = spot[1] - marks[m][1], far = across * across + up * up;
            if (far < least) { least = far; which = m; }
        }
        sum = sum * 3 + which;
    }
    return sum;
}
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 18; turn++) printed.push(String(ops[steps[0]](spots, turn, holders[turn % holders.length])));
console.log(printed.join(" "));
