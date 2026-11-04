const seen: string[] = [];
const numbers: any[] = [0, -0, 1, -1, 7, 2147483647, -2147483648, 1.5, -0.5, NaN, Infinity, -Infinity, 4294967296, 9007199254740991, 5e-324];
const others: any[] = [0, -0, 1, -1, 7, 8, 2147483647, -2147483648, 1.5, NaN, Infinity, -Infinity, 4294967296, "7", "abc", "", " 1 ", undefined, null, true, false, 7n, -1n, 9007199254740993n, { valueOf() { seen.push("valueOf"); return 7; } }, { toString() { seen.push("toString"); return "1"; } }, [2], []];
const list: number[] = [0, 0];
(globalThis as any).kept = list;
function ask(a: any, b: any): boolean { list[0] = a; (list as any)[1] = b; return list[1] >= list[0]; }
function turns(xs: any[], ys: any[]): number { let c = 0; for (const a of xs) for (const b of ys) { list[0] = a; (list as any)[1] = b; for (let i = 0; i < 2; i++) { if (list[1] >= list[0]) c++; } } return c; }
let line = "";
for (const a of numbers) { line = ""; for (const b of others) line += ask(a, b) ? "1" : "0"; console.log(line, seen.length); }
console.log(turns(numbers, others));
