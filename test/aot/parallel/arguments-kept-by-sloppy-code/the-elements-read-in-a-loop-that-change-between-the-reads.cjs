// Sloppy code. Between the reads of one loop an element is stored, deleted, and laid again. The object is held by a closure of its function, which reads its elements in a loop that goes past its end and whose bound comes out of data.
// STATISTIC: ArgumentsElementsReadInline >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
let kept;
function keep(first, second) { kept = arguments; const held = arguments; return function read(turn) { let text = "" + turn; for (let i = 0; i < upTo[6]; i++) { text += ":" + held[1]; if (i === 0) held[1] = turn; if (i === 1) delete held[1]; if (i === 3) held[1] = "again"; } return text; }; }
const read = keep(1, "two", null);
for (let turn = 0; turn < 3; turn++) console.log(read(turn));
