// STATISTIC: HoldersOnlyMeasuredByHeadsGuessedToBeLists >= 1
"use strict";
// The read of the length throws in the first turn of the outer loop, behind what stands in front of it; with no points it is never reached.
const spots = JSON.parse('[[0.5,1.5],[2.25,0.75],[3.5,3.25],[1.125,2.5],[4.75,0.25],[2.5,2.5]]');
const holders = [null, JSON.parse('[0,0]'), undefined];
let reached = 0;
function inner(all, shift, measured) {
    const marks = [all[shift % 6], all[(shift + 2) % 6], all[(shift + 5) % 6]];
    let sum = 0;
    for (const spot of shift % 5 === 4 ? [] : all) {
        reached++;
        for (let m = 0; m < measured.length; m++) sum += spot[0] - marks[m][0];
    }
    return sum;
}
function nearest(all, shift, measured) { try { return inner(all, shift, measured) + ":" + reached; } catch (error) { return error.name + ":" + reached; } }
const ops = { nearest, idle() { return 0; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 18; turn++) printed.push(String(ops[steps[0]](spots, turn, holders[turn % holders.length])));
console.log(printed.join(" "));
