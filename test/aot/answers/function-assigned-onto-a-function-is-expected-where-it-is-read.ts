// answers: without-library
// # `Object.assign(holder, { Point })`, where holder is a function: what lands on a function lies there under its key as what a store by name lays there does. Two functions are copied under the name here, so nothing is held of the read and the construction stays as written.
// # f1 = Point, f2 = run
// # RUN(HELD): link held calls mechanisms=all
// # HELD-NOT: call f2 {{*}} -> f1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
function Point(this: any, x: number) { this.x = x; }
const holder: any = function Holder() {};
Object.assign(holder, { Point, tag: 1 });
function run(turns: number): number { let sum = 0; for (let i = 0; i < turns; i++) { sum += new holder.Point(i).x; } return sum; }
report(run(100));
Object.assign(holder, { Point: function Other(this: any, x: number) { this.x = -x; } });
report(run(100));
report("end");
declare function report(value: unknown): void;
