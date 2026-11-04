const seen: string[] = [];
const numbers: any[] = [0, -0, 1, -1, 7, 2147483647, -2147483648, 1.5, -0.5, NaN, Infinity, -Infinity, 4294967296, 9007199254740991, 5e-324];
const others: any[] = [0, -0, 1, -1, 7, 8, 2147483647, -2147483648, 1.5, NaN, Infinity, -Infinity, 4294967296, "7", "abc", "", " 1 ", undefined, null, true, false, 7n, -1n, 9007199254740993n, { valueOf() { seen.push("valueOf"); return 7; } }, { toString() { seen.push("toString"); return "1"; } }, [2], []];
function ask(a: any, b: any): boolean { if (typeof a === "number") return a < b; return false; }
function turns(xs: any[], ys: any[]): number { let c = 0; for (const a of xs) { if (typeof a !== "number") continue; for (const b of ys) { if (a < b) c++; } } return c; }
(globalThis as any).kept = [ask, turns];
let line = "";
for (const a of numbers) { line = ""; for (const b of others) line += ask(a, b) ? "1" : "0"; console.log(line, seen.length); }
console.log(turns(numbers, others));
