// Sloppy code. An operand was undefined; beside it an element is deleted: the two read alike and are told apart by `in`. The object is held by a closure of its function, which reads its elements in a loop that goes past its end and whose bound comes out of data.
// STATISTIC: ArgumentsElementsReadInline >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
let kept;
function keep(first, second) { kept = arguments; const held = arguments; return function read(turn) { let text = "" + turn; for (let i = 0; i < upTo[4]; i++) text += ":" + held[i] + (i in held); return text; }; }
const read = keep(undefined, "two", undefined);
delete kept[2];
for (let turn = 0; turn < 3; turn++) console.log(read(turn));
