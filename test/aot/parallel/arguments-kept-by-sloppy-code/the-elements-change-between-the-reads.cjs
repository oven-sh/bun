// Between the reads of one loop an element is stored, deleted, and laid again.
// COUNT: operation:operationAOTGetByVal <= 16
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
function read(list, turn) { let text = "" + turn; for (let i = 0; i < 6; i++) { text += ":" + list[1]; if (i === 0) list[1] = turn; if (i === 1) delete list[1]; if (i === 3) list[1] = "again"; } return text; }
globalThis.handed = [read];
for (let turn = 0; turn < 3; turn++) console.log(read(kept, turn));
