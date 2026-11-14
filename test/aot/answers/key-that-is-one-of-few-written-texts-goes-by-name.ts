// answers: without-library
// # `p[k]` in a loop, where k is proven one of few written texts and comes from further up than the block of the access: the key is compared with all its texts but the last, and an arm a text is walked as the access by that name,
// # where each name has a typed form on what is proven of the receiver. Outside of loops, and off a receiver of which nothing is proven, the access stays as it is written.
// # f1 = inArms, f2 = ofThree, f3 = stores, f4 = outside, f5 = ofAnyone
// # RUN(ARMS): walk f1:Body mechanisms=all
// # ARMS-LABEL: code f1:Body
// # ARMS-NOT: = ElemGet
// # ARMS: = StringEqualsLiteral
// # RUN(STORES): walk f3:Body mechanisms=all
// # STORES-LABEL: code f3:Body
// # STORES-NOT: = ElemSet
// # RUN(OUTSIDE): walk f4:Body mechanisms=all
// # OUTSIDE-LABEL: code f4:Body
// # OUTSIDE-NOT: = StringEqualsLiteral
// # RUN(ANYONE): walk f5:Body mechanisms=all
// # ANYONE-LABEL: code f5:Body
// # ANYONE-NOT: = StringEqualsLiteral
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 10 of 10 of 10
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
class Point { x = 1; y = 2; z = 3; }
function inArms(n: number) { const p = new Point(); let s = 0; for (let i = 0; i < n; i++) { const k = i & 1 ? "x" : "y"; if (i & 2) s += 100; s += p[k]; } return [s]; }
function ofThree(n: number) { const p = new Point(); let s = 0; for (let i = 0; i < n; i++) { const k = i % 3 === 0 ? "x" : i % 3 === 1 ? "y" : "z"; if (i & 2) s += 100; s += p[k]; } return [s]; }
function stores(n: number) { const p = new Point(); for (let i = 0; i < n; i++) { const k = i & 1 ? "x" : "y"; if (i & 2) p.z += 1; p[k] = i; } return [p.x * 1000 + p.y * 10 + p.z]; }
function outside(n: number) { const p = new Point(); const k = n & 1 ? "x" : "y"; if (n & 2) n += 100; return [p[k] + n]; }
function ofAnyone(p: any, n: number) { let s = 0; for (let i = 0; i < n; i++) { const k = i & 1 ? "x" : "y"; if (i & 2) s += 100; s += p[k]; } return [s]; }
function tell(f: () => unknown[]) { try { report(f()[0]); } catch (e) { report((e as Error).name); } }
tell(() => inArms(5)); tell(() => ofThree(7)); tell(() => stores(6)); tell(() => outside(1)); tell(() => outside(2)); tell(() => ofAnyone(new Point(), 5));
const odd: any = JSON.parse('{"y":"text"}'); Object.defineProperty(odd, "x", { get() { return 10; } }); tell(() => ofAnyone(odd, 4)); tell(() => ofAnyone(null as any, 2)); tell(() => ofAnyone(undefined as any, 0));
report("end");
