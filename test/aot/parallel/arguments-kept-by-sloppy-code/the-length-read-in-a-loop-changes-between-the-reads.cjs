// The length is overwritten, deleted and laid again between the reads of one loop. The object is held by a closure of its function, which reads its length in a loop whose bound comes out of data.
// STATISTIC: LengthsOfArgumentsObjectsReadInLine >= 1
const upTo = JSON.parse("[0,1,2,3,4,5]");
let kept;
function keep(first, second) { kept = arguments; const held = arguments; return function count(turn) { let sum = "" + turn; for (let i = 0; i < upTo[4]; i++) { sum += ":" + held.length; if (i === 0) held.length = 7; if (i === 1) delete held.length; if (i === 2) held.length = turn; } return sum; }; }
const count = keep(1, "two", null);
for (let turn = 0; turn < 3; turn++) console.log(count(turn));
