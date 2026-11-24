// The length was deleted and the prototype exchanged for an object that has one.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
delete kept.length;
Object.setPrototypeOf(kept, { length: 9 });
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) console.log(count(kept, turn));
