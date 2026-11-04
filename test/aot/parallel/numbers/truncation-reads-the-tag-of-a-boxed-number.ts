// `x | 0`, `x >>> 0`, `0 ^ x`, `x << 0`, `x >> 0` on a number that lies boxed: int32s, fractions, numbers past 2 ** 32 and 2 ** 53, -0, NaN, the infinities
function cut(x: any) { if (typeof x === "number") return (x | 0) + " " + (x >>> 0) + " " + (0 ^ x) + " " + (x << 0) + " " + (x >> 0); return "no number"; }
const outside: any[] = JSON.parse("[0, -0, 7, -7, 0.9, -0.9, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967297.75, 9007199254740993, 1e21, -1e21, 1e308]");
function deed(x: unknown) { return cut(x); }
console.log(deed(5), deed(-5.5));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn * 16777216.5);
console.log(log);
for (let i = 0; i < outside.length; i++) console.log(deed(outside[i]));
console.log(deed(NaN), deed(Infinity), deed(-Infinity), deed("5"), deed(null));
