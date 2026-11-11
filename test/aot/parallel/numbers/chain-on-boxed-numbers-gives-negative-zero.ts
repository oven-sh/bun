// a chain of operators on numbers that arrive boxed is walked on integers: a product of int32s that is -0, and a product past 2 ** 53
function chain(a: any, b: any, c: any) { if (typeof a === "number" && typeof b === "number" && typeof c === "number") { const p = a * b + c; return 1 / p; } return "no numbers"; }
function compare(a: any, b: any, c: any) { if (typeof a === "number" && typeof b === "number" && typeof c === "number") { const same = a * b - c === 0; return same; } return "no numbers"; }
const outside: any[] = JSON.parse("[0, -0, -1, 1, 2147483647, -2147483648, 0.5]");
function deed(a: unknown, b: unknown, c: unknown) { return String(chain(a, b, c)) + " " + String(compare(a, b, c)); }
console.log(deed(2, 3, 4), deed(0, -1, -0));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn, -1, turn);
console.log(log);
for (let i = 0; i < outside.length; i++) for (let j = 0; j < outside.length; j++) console.log(deed(outside[i], outside[j], outside[(i + j) % outside.length]));
console.log(deed(2147483647, 2147483647, 2147483647), deed(-2147483648, -2147483648, 1), deed("2", 3, 4));
