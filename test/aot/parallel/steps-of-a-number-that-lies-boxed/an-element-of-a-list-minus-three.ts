function show(x: unknown): string { return Object.is(x, -0) ? "-0" : typeof x + ":" + String(x); }
const values: any[] = [0, -0, 1, -1, 7, 2147483647, 2147483646, -2147483648, -2147483647, 1.5, -0.5, 0.1, NaN, Infinity, -Infinity, 4294967296, -4294967297, 9007199254740991, -9007199254740992, 1e308, 5e-324, 1073741824];
const list: number[] = [0, 0];
(globalThis as any).kept = list;
function step(): void { list[1] -= 3; }
function steps(n: number): void { for (let i = 0; i < n; i++) { list[1] -= 3; } }
for (const v of values) { list[1] = v; step(); console.log(show(list[1])); list[1] = v; steps(3); console.log(show(list[1])); }
