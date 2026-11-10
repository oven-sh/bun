// The length is overwritten, deleted and laid again between the reads of one loop.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
function count(list, turn) { let sum = "" + turn; for (let i = 0; i < 4; i++) { sum += ":" + list.length; if (i === 0) list.length = 7; if (i === 1) delete list.length; if (i === 2) list.length = turn; } return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) console.log(count(kept, turn));
