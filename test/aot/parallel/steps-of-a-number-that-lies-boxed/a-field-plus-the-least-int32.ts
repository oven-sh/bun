function show(x: unknown): string { return Object.is(x, -0) ? "-0" : typeof x + ":" + String(x); }
const values: any[] = [0, -0, 1, -1, 7, 2147483647, 2147483646, -2147483648, -2147483647, 1.5, -0.5, 0.1, NaN, Infinity, -Infinity, 4294967296, -4294967297, 9007199254740991, -9007199254740992, 1e308, 5e-324, 1073741824];
class Holder { pos: number = 0; step(): void { this.pos += -2147483648; } steps(n: number): void { for (let i = 0; i < n; i++) { this.pos += -2147483648; } } }
const it = new Holder();
(globalThis as any).kept = it;
for (const v of values) { it.pos = v; it.step(); console.log(show(it.pos)); it.pos = v; it.steps(3); console.log(show(it.pos)); }
