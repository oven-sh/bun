// answers: without-library
// # The descriptor is made by somebody else: nobody says at the call what it holds. All is as it was: the subject is handed to unseen code.
// # f1 = define.
// # RUN(SCAN): summary f1
// # SCAN: change {{*}} DefinesByDescriptor Parameter 0 "shown"
// # RUN(NEVER): summary f1
// # NEVER-NOT: descriptor-in-sight
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function define(o: object, descriptor: PropertyDescriptor) { Object.defineProperty(o, "shown", descriptor); }
function make(start: number) { let pos = start; const o = { next: () => pos++, peek: () => pos }; define(o, { get: () => pos }); return o; }
const s = make(1);
let sum = 0;
for (let i = 0; i < 100; i++) sum += s.next() + s.peek();
report(sum);
report((s as any).shown);
report("end");
