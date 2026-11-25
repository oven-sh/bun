// An arguments object of sloppy code, whose elements are its parameters, is kept and asked for its length by another function, in a loop.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) console.log(count(kept, turn));
