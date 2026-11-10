// Strict code. The call had fewer operands than the function has parameters, which it stores to: the object has no element for them. The object is held by a closure of its function, which reads its elements in a loop that goes past its end and whose bound comes out of data.
// STATISTIC: ElementsOfArgumentsObjectsReadInLine >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
let kept;
function keep(first, second, third) { second = 5; third = 6; kept = arguments; const held = arguments; return function read(turn) { let text = "" + turn; for (let i = 0; i < upTo[5]; i++) text += ":" + held[i]; return text; }; }
const read = keep(1);
for (let turn = 0; turn < 3; turn++) console.log(read(turn));
