// STATISTIC: ListsKeptAtHeadsThoughAnAnswerAboutThemWasForgotten >= 1
"use strict";
// Points that are no lists of numbers run the copy that claims nothing; it reads the literal as it was made.
const spots = JSON.parse('[[0.5,1.5],{"0":2,"1":3},"ab",[3,4],[null,1],[1.5],[],{"0":"7","1":[1]}]');
function nearest(all, shift) {
    const marks = [all[shift % 8], all[(shift + 3) % 8], all[(shift + 5) % 8]];
    const seen = [];
    for (const spot of all) {
        let which = -1, least = Infinity;
        for (let m = 0; m < marks.length; m++) {
            const across = spot[0] - marks[m][0], up = spot[1] - marks[m][1], far = across * across + up * up;
            if (far < least) { least = far; which = m; }
        }
        seen.push(which);
    }
    return seen.join("");
}
const ops = { nearest, idle() { return ""; } }, steps = JSON.parse('["nearest"]');
const printed = [];
for (let turn = 0; turn < 24; turn++) printed.push(ops[steps[0]](spots, turn));
console.log(printed.join(" "));
