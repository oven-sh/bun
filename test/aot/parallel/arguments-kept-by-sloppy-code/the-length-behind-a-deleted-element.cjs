// An element was deleted, which parts it from its parameter: the length stays.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
delete kept[0];
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) console.log(count(kept, turn));
