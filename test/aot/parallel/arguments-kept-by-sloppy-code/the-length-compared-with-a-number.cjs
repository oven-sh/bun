// The length is compared with a written number: as made, overwritten by the same number out of a division, by a fraction, by a text of the same digits, and deleted.
function keep(first, second) { return arguments; }
const kept = keep(1, "two", null);
const halves = JSON.parse("[6,7]");
function count(list, turn) { let sum = "" + turn; for (let i = 0; i < 5; i++) { sum += ":" + (list.length === 3) + (list.length == 3); if (i === 0) list.length = halves[0] / 2; if (i === 1) list.length = halves[1] / 2; if (i === 2) list.length = "3"; if (i === 3) delete list.length; } list.length = 3; return sum; }
globalThis.handed = [count];
for (let turn = 0; turn < 3; turn++) console.log(count(kept, turn));
