const which = JSON.parse("1") | 0;
const seen = { early: 0, late: 0 };
function first(x) { return 1; }
function second(x) { return 2; }
function third(x) { return 3; }
function fourth(x) { return 4; }
function early(x) { seen.early = x; more(); }
function late(x) { seen.late = x; console.log(typeof seen.early, typeof seen.late); }
late(1);
const mixed = [first, early, second, third, fourth];
function hand(index) { setTimeout(mixed[index], 0); }
function more() { mixed.push(late); hand(which + 4); }
hand(which);
