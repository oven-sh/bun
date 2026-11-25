// The function stored to its parameters before it handed the object out: the elements are what was stored.
// COUNT: operation:operationAOTGetByVal <= 6
function keep(first, second) { first = 7; second = "late"; return arguments; }
const kept = keep(1, "two", null);
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn));
