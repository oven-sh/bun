function show(x: unknown): string { return Object.is(x, -0) ? "-0" : typeof x + ":" + String(x); }
const values: any[] = [0, -0, 1, -1, 7, 2147483647, 2147483646, -2147483648, -2147483647, 1.5, -0.5, 0.1, NaN, Infinity, -Infinity, 4294967296, -4294967297, 9007199254740991, -9007199254740992, 1e308, 5e-324, 1073741824];
function step(a: any): unknown { if (typeof a === "number") { a -= 2147483647; return a; } return "none"; }
function steps(a: any, n: number): unknown { if (typeof a !== "number") return "none"; for (let i = 0; i < n; i++) { a -= 2147483647; } return a; }
(globalThis as any).kept = [step, steps];
for (const v of values) { console.log(show(step(v)), show(steps(v, 3))); }
console.log(show(step("1")), show(steps(undefined, 2)));
