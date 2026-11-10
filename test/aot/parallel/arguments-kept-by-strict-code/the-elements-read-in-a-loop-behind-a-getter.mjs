// Strict code. An element was defined anew as a getter: every read calls it. The object is held by a closure of its function, which reads its elements in a loop that goes past its end and whose bound comes out of data.
// STATISTIC: ElementsOfArgumentsObjectsReadInLine >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
let kept;
function keep(first, second) { kept = arguments; const held = arguments; return function read(turn) { let text = "" + turn; for (let i = 0; i < upTo[5]; i++) text += ":" + held[i]; return text; }; }
const read = keep(1, "two", null);
let calls = 0;
Object.defineProperty(kept, 0, { get() { return ++calls; }, configurable: true });
for (let turn = 0; turn < 3; turn++) console.log(read(turn));
