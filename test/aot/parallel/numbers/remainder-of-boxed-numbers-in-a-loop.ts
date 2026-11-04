// in a loop a remainder of two numbers that lie boxed has an integer arm: `% 0`, `-1 % 1` (-0), -(2 ** 31) % -1, a fraction, an infinity
function wrap(x: any, y: any) { if (typeof x === "number" && typeof y === "number") { let log = ""; for (let i = 0; i < 2; i++) { const r = x % y; log += (Object.is(r, -0) ? "-0" : String(r)) + ","; } return log; } return "no numbers"; }
const outside: any[] = JSON.parse("[0, -0, 1, -1, 7, -7, 3, 2147483647, -2147483648, 2.5, 4294967296]");
function deed(x: unknown, y: unknown) { return wrap(x, y); }
console.log(deed(7, 3), deed(-7, 3), deed(-1, 1));
let last = "";
for (let turn = 0; turn < 300; turn++) last = deed(turn, 7);
console.log(last);
for (let i = 0; i < outside.length; i++) for (let j = 0; j < outside.length; j++) console.log(deed(outside[i], outside[j]));
console.log(deed(NaN, 2), deed(5, Infinity), deed(Infinity, 5), deed("7", 3));
