"use strict";
// The literal is only read; the ROW that both reads find is stored into between them.
const spots = JSON.parse('[[1,2],[3,4],[5,6],[7,8]]');
function move(all, shift) {
    const marks = [all[shift % 4], all[(shift + 1) % 4], all[(shift + 2) % 4]];
    let sum = 0;
    for (const spot of all) {
        for (let m = 0; m < marks.length; m++) {
            const before = marks[m][0];
            marks[m][0] = before + spot[1];
            sum = (sum * 3 + before + marks[m][0]) % 1000003;
        }
    }
    return sum;
}
const ops = { move, idle() { return 0; } }, steps = JSON.parse('["move"]');
const printed = [];
for (let turn = 0; turn < 20; turn++) printed.push(ops[steps[0]](spots, turn));
console.log(printed.join(" "));
