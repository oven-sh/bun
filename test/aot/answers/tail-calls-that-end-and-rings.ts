// answers: without-library
// # a row of tail calls that ends in a function that returns, a ring of two, and a jump to a function that takes more arguments than its caller has room for in registers: the words lie where the callers of the caller left room
// # f1 = leaf, f2 = viaLeaf, f3 = viaViaLeaf, f4 = even, f5 = odd, f6 = wide, f7 = narrow, f8 = first, f9 = byValue, f10 = tell
// # RUN(FORM): walk f3 mechanisms=all-Inlining
// # FORM-LABEL: code f3:Body
// # FORM: ReturnCall {{*}}requirement=Allowed
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function leaf(v: { x: number }): number { return v.x; }
function viaLeaf(v: { x: number }): number { return leaf(v); }
function viaViaLeaf(v: { x: number }): number { return viaLeaf(v); }
function even(n: number): boolean { return n === 0 ? true : odd(n - 1); }
function odd(n: number): boolean { return n === 0 ? false : even(n - 1); }
function wide(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + k * 11 + l * 12; }
function narrow(a: number): number { return wide(a, a + 1, a + 2, a + 3, a + 4, a + 5, a + 6, a + 7, a + 8, a + 9, a + 10, a + 11); }
function first(a: number): number { return narrow(a + 1); }
function byValue(f: (...values: number[]) => number, a: number): number { return f(a, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => viaViaLeaf({ x: 3 }));
tell(() => viaViaLeaf(null as any));
tell(() => viaViaLeaf({ x: 4 }) + viaLeaf({ x: 5 }));
tell(() => even(10));
tell(() => odd(7));
tell(() => even(2001));
tell(() => first(1));
tell(() => first(1) + first(2) * 2);
tell(() => narrow(0.5));
tell(() => byValue(wide, 1));
tell(() => byValue(narrow as any, 5));
tell(() => byValue(first as any, 5) + byValue(wide, 2));
tell(() => byValue(null as any, 5));
report("end");
