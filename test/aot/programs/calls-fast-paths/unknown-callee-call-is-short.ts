// The machine code for calling an unknown function value is short: the checks are in shared code.
// SIZE< call0 100
// SIZE< call2 128
// SIZE< callAny 160
declare const console: any;
function call0(f: () => number): number { return f(); }
function call2(f: (a: number, b: string) => number, a: number, b: string): number { return f(a, b) + 1; }
function callAny(f: any, a: any): any { return f(a); }
const fs0 = [() => 1, () => 2], fs2 = [(a: number, b: string) => a + b.length, (a: number, b: string) => a - b.length], fsAny = [(x: number) => x, (x: number) => -x];
let s = 0;
for (let i = 0; i < 3_000_000; i++) s += call0(fs0[i & 1]) + call2(fs2[i & 1], i & 7, "xy") + callAny(fsAny[i & 1], i & 3);
// Called once outside any loop too: top-level code that runs once takes nothing in, so the function keeps a body for the expectations to look at.
s += call0(fs0[0]) + call2(fs2[0], 1, "xy") + callAny(fsAny[0], 1);
console.log(s);
export {};
