// The length is compared with a written number: as made, overwritten by the same number out of a division, by a fraction, by a text of the same digits, and deleted. The object is held by a closure of its function, which reads its length in a loop whose bound comes out of data.
// STATISTIC: LengthsOfArgumentsObjectsReadInLine >= 1
const upTo = JSON.parse("[0,1,2,3,4,5]");
let kept;
const halves = JSON.parse("[6,7]");
function keep(first, second) { kept = arguments; const held = arguments; return function count(turn) { let sum = "" + turn; for (let i = 0; i < upTo[5]; i++) { sum += ":" + (held.length === 3) + (held.length == 3); if (i === 0) held.length = halves[0] / 2; if (i === 1) held.length = halves[1] / 2; if (i === 2) held.length = "3"; if (i === 3) delete held.length; } held.length = 3; return sum; }; }
const count = keep(1, "two", null);
for (let turn = 0; turn < 3; turn++) console.log(count(turn));
