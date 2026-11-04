function show(x: unknown): string { return Object.is(x, -0) ? "-0" : typeof x + ":" + String(x); }
const values: any[] = [0, -0, 1, -1, 7, 2147483647, 2147483646, -2147483648, -2147483647, 1.5, -0.5, 0.1, NaN, Infinity, -Infinity, 4294967296, -4294967297, 9007199254740991, -9007199254740992, 1e308, 5e-324, 1073741824];
function make() {
  let pos: number = 0;
  return { set(p: any): void { pos = p; }, step(): void { pos += 1; }, steps(n: number): void { for (let i = 0; i < n; i++) { pos += 1; } }, at(): number { return pos; } };
}
const it = make();
(globalThis as any).kept = it;
for (const v of values) { it.set(v); it.step(); console.log(show(it.at())); it.set(v); it.steps(3); console.log(show(it.at())); }
