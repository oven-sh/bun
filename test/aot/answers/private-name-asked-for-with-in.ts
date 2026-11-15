// answers: without-library
// # `#x in o` for fields, methods, accessors and static names, on instances and on everything else.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 112 of 112 of 112
// # CHECK-NEXT: exited with 0
class A { #x = 1; #m() {} static #s = 1; static #sm() {} get #g() { return 1; } static x(o: any) { return #x in o; } static m(o: any) { return #m in o; } static s(o: any) { return #s in o; } static sm(o: any) { return #sm in o; } static g(o: any) { return #g in o; } isA(o: A | { q: number }) { return #x in o; } }
class B extends A { own = 1; }
function attempt(f: () => unknown) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
const values: any[] = [new A(), new B(), A, B, {}, A.prototype, null, undefined, 1, "s", Object.create(new A())];
for (let round = 0; round < 2; round++) { for (let i = 0; i < values.length; i++) { const v = values[i]; attempt(() => A.x(v)); attempt(() => A.m(v)); attempt(() => A.s(v)); attempt(() => A.sm(v)); attempt(() => A.g(v)); } }
const a = new A();
let n = 0;
for (let i = 0; i < 300; i++) { if (a.isA(i & 1 ? a : { q: 1 })) n++; }
report(n);
report("end");
declare function report(value: unknown): void;
