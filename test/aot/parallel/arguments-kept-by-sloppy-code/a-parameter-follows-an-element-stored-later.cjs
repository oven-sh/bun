// An element is stored after the object has left: the read gives it, and the parameter follows.
// COUNT: operation:operationAOTGetByVal <= 6
let look;
function keep(first, second) { look = () => first + "/" + second; return arguments; }
const kept = keep(1, "two", null);
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) { kept[0] = turn * 10; kept[2] = "z" + turn; console.log(read(kept, turn), look()); }
