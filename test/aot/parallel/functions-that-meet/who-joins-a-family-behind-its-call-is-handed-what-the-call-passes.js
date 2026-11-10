const seen = { first: 0, second: 0, late: 0 };
function first(x) { seen.first = x; return 1; }
function second(x) { seen.second = x; return 2; }
function third(x) { return 3; }
function fourth(x) { return 4; }
function fifth(x) { return 5; }
function late(x) { seen.late = x; return 6; }
const which = JSON.parse("5") | 0;
const held = [first, second, third, fourth, fifth];
function callHeld(index, value) { return held[index](value); }
console.log(callHeld(0, 7), callHeld(1, 8), seen.first + 1, seen.second + 1);
held.push(late);
console.log(callHeld(which, "text"), typeof seen.late, seen.late + 1);
