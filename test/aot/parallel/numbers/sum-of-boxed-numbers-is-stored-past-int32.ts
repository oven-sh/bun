// a sum of two numbers that lie boxed is stored boxed: at the ends of int32, for two negative zeros, for a fraction beside an int32, with a collection between the sum and its read
const holder: any = JSON.parse('{"total": 0}');
function store(a: any, b: any) { if (typeof a === "number" && typeof b === "number") holder.total = a + b; return holder.total; }
function take(a: any, b: any) { if (typeof a === "number" && typeof b === "number") holder.total = a - b; return holder.total; }
const outside: any[] = JSON.parse("[0, -0, 1, 2147483647, -2147483648, 0.25, 9007199254740992, 1e308]");
function deed(a: unknown, b: unknown) { const sum = store(a, b); Bun.gc(true); return (Object.is(sum, -0) ? "-0" : String(sum)) + " " + (Object.is(take(a, b), -0) ? "-0" : String(holder.total)); }
console.log(deed(1, 2), deed(2147483647, 1), deed(-2147483648, 1));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn, 2147483600 + (turn & 63));
console.log(log);
for (let i = 0; i < outside.length; i++) for (let j = 0; j < outside.length; j++) console.log(deed(outside[i], outside[j]));
console.log(deed(NaN, 1), deed(Infinity, -Infinity), deed("1", 2));
