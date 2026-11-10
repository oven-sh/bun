// The length was overwritten by a text: the read gives the text. The object is held by a closure of its function, which reads its length in a loop whose bound comes out of data.
// STATISTIC: ArgumentsLengthsReadInline >= 1
const upTo = JSON.parse("[0,1,2,3,4,5]");
let kept;
function keep(first, second) { kept = arguments; const held = arguments; return function count(turn) { let sum = turn; for (let i = 0; i < upTo[4]; i++) sum += held.length; return sum; }; }
const count = keep(1, "two", null);
kept.length = "x";
for (let turn = 0; turn < 3; turn++) console.log(count(turn));
