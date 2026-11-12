"use strict";
// The list that is filled is NOT made here: it comes from in front, like the list that is read, and is the same list: each push moves the length that the loop's head reads and may move the vector under the reads.
const said = [];
function handed(d, out) { let s = 0; for (let i = 0; i < d.length && i < 300; i++) { out.push(d[i] + 1); s = (s + d[i]) | 0; } return s + " " + d.length; }
function halves(d, out) { let s = 0; for (let i = 0; i < d.length && i < 300; i++) { out.push(d[i] + 0.5); s += d[i]; } return s + " " + d.length; }
function popped(d, out) { let s = 0; for (let i = 0; i < d.length; i++) { s = (s + d[i]) | 0; out.pop(); } return s + " " + d.length; }
function shifted(d, out) { let s = 0; for (let i = 0; i < d.length; i++) { s = (s + d[i]) | 0; out.shift(); } return s + " " + d.length; }
for (let round = 0; round < 3; round++) {
    const one = [1, 2, 3], two = [1, 2, 3], three = [1, 2, 3], four = [], five = [], six = [];
    for (let i = 0; i < 100; i++) { four.push(i); five.push(i); six.push(i); }
    said.push(handed(one, one), handed(two, []), halves(three, three), halves([1, 2, 3], []), popped(four, four), popped(five, [1]), shifted(six, six), shifted([1, 2, 3], [1]));
}
console.log(said.join(" "));
