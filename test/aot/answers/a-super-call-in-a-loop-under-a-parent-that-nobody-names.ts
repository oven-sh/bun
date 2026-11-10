// answers: without-library
// # `super(i)` written in a loop, under a parent that neither reading names. The loop is asked whether a typed copy of it could run no other code, and the first operation that runs other code is the SuperConstruct,
// # which has a parent and no callee: the question once asked it for its callee, and the getter stopped the build.
// # f1 = id, f2 = Below
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
const Base: any = (0, eval)("(class { constructor(a) { this.a = a; } })");
class Below extends Base { constructor(n: number) { const last = n | 0; for (let i = 0; i <= last; i++) { if (i === last) super(i); } } }
report((new Below(id(3)) as any).a);
report("end");
