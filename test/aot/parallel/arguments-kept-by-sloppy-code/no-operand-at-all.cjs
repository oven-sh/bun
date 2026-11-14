// The call had no operand.
function keep(first) { return arguments; }
const kept = keep();
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 5; i++) text += ":" + list[i]; return text; }
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [read, count];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn), count(kept, turn));
