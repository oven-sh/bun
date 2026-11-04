const seen: string[] = [];
const numbers: any[] = [0, -0, 1, -1, 7, 2147483647, -2147483648, 1.5, -0.5, NaN, Infinity, -Infinity, 4294967296, 9007199254740991, 5e-324];
const others: any[] = [0, -0, 1, -1, 7, 8, 2147483647, -2147483648, 1.5, NaN, Infinity, -Infinity, 4294967296, "7", "abc", "", " 1 ", undefined, null, true, false, 7n, -1n, 9007199254740993n, { valueOf() { seen.push("valueOf"); return 7; } }, { toString() { seen.push("toString"); return "1"; } }, [2], []];
class Holder { pos: number = 0; end: number = 0; ask(): boolean { return this.end >= this.pos; } count(n: number): number { let c = 0; for (let i = 0; i < n; i++) { if (this.end >= this.pos) c++; } return c; } }
const it = new Holder();
(globalThis as any).kept = it;
function ask(a: any, b: any): boolean { it.pos = a; it.end = b; return it.ask(); }
function turns(xs: any[], ys: any[]): number { let c = 0; for (const a of xs) for (const b of ys) { it.pos = a; it.end = b; c += it.count(2); } return c; }
let line = "";
for (const a of numbers) { line = ""; for (const b of others) line += ask(a, b) ? "1" : "0"; console.log(line, seen.length); }
console.log(turns(numbers, others));
