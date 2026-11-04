// a row of `||` over comparisons with integers, 0 among them, is asked about NaN, which equals nothing, and about -0, which equals 0
function isLow(k) { return k === 0 || k === 3 || k === 5; }
function deed(k) { return String(isLow(k)); }
const values = [NaN, -0, 0, 3, 5, 4, -3, 0.5, -0.5, 1 / -Infinity];
let out = "";
for (let i = 0; i < values.length; i++) out += deed(values[i]) + " ";
console.log(out);
let count = 0;
for (let turn = 0; turn < 400; turn++) for (let i = 0; i < values.length; i++) if (isLow(values[i])) count++;
console.log(String(count));
console.log(deed(NaN), deed(-0), deed(Number("x")), deed(Math.round(-0.2)));
