// The length was deleted: the read finds nothing.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
delete kept.length;
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) console.log(count(kept, turn));
