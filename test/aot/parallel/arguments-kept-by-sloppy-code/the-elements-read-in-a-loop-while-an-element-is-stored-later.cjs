// Sloppy code. Elements are stored later: the read gives them; in sloppy code the parameter follows. The object is held by a closure of its function, which reads its elements in a loop that goes past its end and whose bound comes out of data.
// STATISTIC: ElementsOfArgumentsObjectsReadInLine >= 1
const upTo = JSON.parse("[0,1,2,3,4,5,6]");
let kept;
let look;
function keep(first, second) { kept = arguments; const held = arguments; look = () => first + "/" + second; return function read(turn) { let text = "" + turn; for (let i = 0; i < upTo[5]; i++) text += ":" + held[i]; return text; }; }
const read = keep(1, "two", null);
for (let turn = 0; turn < 3; turn++) { kept[0] = turn * 10; kept[2] = "z" + turn; console.log(read(turn), look()); }
