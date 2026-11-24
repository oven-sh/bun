// The elements of a kept arguments object of sloppy code are read by another function, in a loop that goes past its end.
// COUNT: operation:operationAOTGetByVal <= 6
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn));
