// The length was overwritten by a lesser number: the elements stay.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
kept.length = 1;
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn));
