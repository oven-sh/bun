// The object was asked for its callee and its iterator: the length stays.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
console.log(kept.callee === keep, typeof kept[Symbol.iterator]);
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) console.log(count(kept, turn));
