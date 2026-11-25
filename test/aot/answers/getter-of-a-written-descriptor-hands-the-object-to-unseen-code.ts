// answers: without-library
// # The engine runs the getter with the object as `this`, at no call that is written, and this getter hands it to a function that may be anybody's. The record names the half, Link brings the object to its `this`, and from there it goes where the body takes it.
// # f1 = make. THE RED CONTROL OF THE ROW: without that edge Link says `result=L1` and `stays-with-compiled-code`: a false proof that no run of six programs shows.
// # RUN(LINK): link functions mechanisms=all
// # LINK: function f1 {{*}}result=object?UnseenCode
// # RUN(NEVER): link layouts mechanisms=all
// # NEVER-NOT: changes=[IsFrozen, GainsProperty, GetsAccessor] stays-with-compiled-code
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
const spoil: (x: any) => void = report("begin") || function (x: any) { x.next = () => "spoiled"; };
function make(start: number) { let pos = start; const o = { next: () => pos++, peek: () => pos }; Object.defineProperty(o, "shown", { get() { spoil(this); return pos; } }); return o; }
const s = make(1);
let sum = 0;
for (let i = 0; i < 100; i++) sum += (s.next() as number) + s.peek();
report(sum);
report((s as any).shown);
report(String(s.next()));
report("end");
