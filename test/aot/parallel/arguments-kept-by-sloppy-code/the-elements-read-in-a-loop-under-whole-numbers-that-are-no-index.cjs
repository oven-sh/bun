// Sloppy code. The keys are whole numbers that the loop reckons: below zero, and past 32 bits, where the low 32 bits alone would name an element; members lie under two of them. The object is held by a closure of its function, which reads its elements in a loop whose bound comes out of data.
// STATISTIC: ArgumentsElementsReadInline >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
let kept;
function keep(first, second) { kept = arguments; const held = arguments; return function read(turn) { let text = "" + turn; for (let i = 0; i < upTo[5]; i++) text += ":" + held[i - 2] + ":" + held[i * 2147483648] + ":" + held[i * 4294967296 + 1]; return text; }; }
const read = keep(1, "two", null);
kept[-1] = "minus";
kept[4294967297] = "far";
for (let turn = 0; turn < 3; turn++) console.log(read(turn));
