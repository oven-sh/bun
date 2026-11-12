// A function whose result is a number or undefined hands it back raw where it is called directly. An int32 or undefined, and integers past int32. It calls itself as often as nobody knows in front, so that the call stays a call wherever its text is copied to.
// STATISTIC: NumbersOrUndefinedReturnedRaw >= 1
const one = Date.now() > 0 ? 1 : 0; let calls = 0;
function low(n: number, depth = one): number | undefined { if (depth > 0) { const r = low(n, depth - 1); calls++; return r; } if (n >= 0) return n & 255; }
function count(text: string, depth = one): number | undefined { if (depth > 0) { const r = count(text, depth - 1); calls++; return r; } if (text) return text.length; }
function large(n: number, depth = one): number | undefined { if (depth > 0) { const r = large(n, depth - 1); calls++; return r; } if (n) return n * 4294967296; }
let sum = 0;
for (let i = -3; i < 300; i += 37) { const r = low(i); sum += r ?? -1; console.log(i, r, r! << 1, r! >>> 0, r! % 7, count("x".repeat(Math.max(i, 0) & 3)), large(i), large(i)! | 0, [10, 20, 30][low(i)! & 1]); }
console.log(sum);
