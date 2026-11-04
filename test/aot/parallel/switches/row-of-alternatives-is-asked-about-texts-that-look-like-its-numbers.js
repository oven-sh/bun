// a row of `||` over comparisons with integers is asked about "1" against 1, about booleans and about a BigInt: `===` converts nothing
function isKind(k) { return k === 1 || k === 4 || k === 9; }
function deed(k) { return String(isKind(k)); }
const values = JSON.parse('["1", "4", "9", 1, 4, 9, true, false, null, " 1", "1.0", [1], {"valueOf": 1}]');
values.push(1n, 4n, Symbol.for("1"));
let out = "";
for (let i = 0; i < values.length; i++) out += deed(values[i]) + " ";
console.log(out);
let count = 0;
for (let turn = 0; turn < 400; turn++) for (let i = 0; i < values.length; i++) if (isKind(values[i])) count++;
console.log(String(count));
