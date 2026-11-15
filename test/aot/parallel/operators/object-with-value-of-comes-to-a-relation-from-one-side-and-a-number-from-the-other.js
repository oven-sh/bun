// a relation takes a number that one side brings or an object with valueOf that the other side brings, and its other operand is an object with valueOf too
let log = "";
const left = { valueOf() { log += "L"; return 3; } };
const right = { valueOf() { log += "R"; return 2; } };
function subject(c, n) { const v = c ? n : left; return v < right; }
function deed(c, n) { return String(subject(c, n)) + log; }
console.log(deed(true, 1), deed(false, 1), deed(1, 2), deed(0, 2), deed("x", NaN));
log = "";
let below = 0;
for (let i = 0; i < 300; i++) below += subject(i % 3, i % 5) ? 1 : 0;
console.log(String(below), String(log.length));
log = "";
left.valueOf = function () { log += "l"; return "1"; };
right.valueOf = function () { log += "r"; return "10"; };
console.log(deed(JSON.parse("0"), 0), deed(JSON.parse("1"), 11));
