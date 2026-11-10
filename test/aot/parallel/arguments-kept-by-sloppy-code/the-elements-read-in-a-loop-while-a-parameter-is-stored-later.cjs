// Sloppy code. A second closure stores to a parameter later: in sloppy code the element follows, in strict code it does not. The object is held by a closure of its function, which reads its elements in a loop that goes past its end and whose bound comes out of data.
// STATISTIC: ElementsOfArgumentsObjectsReadInLine >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
let kept;
let store;
function keep(first, second) { kept = arguments; const held = arguments; store = value => { first = value; }; return function read(turn) { let text = "" + turn; for (let i = 0; i < upTo[5]; i++) text += ":" + held[i]; return text; }; }
const read = keep(1, "two", null);
for (let turn = 0; turn < 3; turn++) { store(turn * 10); console.log(read(turn)); }
