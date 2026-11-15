// The call had fewer operands than the function has parameters: the length is the number of operands.
function keep(first, second, third) { third = 3; return arguments; }
const kept = keep(1);
function count(list, turn) { let sum = turn; for (let i = 0; i < 4; i++) sum += list.length; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) console.log(count(kept, turn));
