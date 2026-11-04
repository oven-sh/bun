// the operands of a sum that only a bit operator takes are expected to be int32; the sum leaves int32, and then the operands do
function add(a: number, b: number) { return (a + b) | 0; }
function addThree(a: number, b: number, c: number) { return (a + b - c) >>> 0; }
const outside: any[] = JSON.parse("[2147483647, -2147483648, 4294967296, 4294967297.5, -0.5, 9007199254740992, 1e21]");
function deed(a: number, b: number) { return add(a, b) + " " + addThree(a, b, 1); }
console.log(deed(1, 2), deed(2147483647, 1), deed(-2147483648, -1));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn, 2147483647 - (turn & 3));
console.log(log);
for (let i = 0; i < outside.length; i++) for (let j = 0; j < outside.length; j++) console.log(deed(outside[i], outside[j]));
console.log(deed(NaN, 1), deed(Infinity, -Infinity), deed(5, 6));
