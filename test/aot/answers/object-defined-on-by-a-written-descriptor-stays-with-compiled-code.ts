// answers: without-library
// # `Object.defineProperty(o, "shown", { get: () => pos })`: the descriptor is written where the call stands and the key is written: the one name changes. The object is handed to nobody, so its maker answers its layout and the closures in its fields keep their callers.
// # f1 = make. The scan says the proof, Link goes by it.
// # RUN(SCAN): summary f1
// # SCAN: change {{*}} DefinesByDescriptor Allocation L{{*}}descriptor-in-sight getter-in-sight=Closure f
// # RUN(NEVER): summary f1
// # NEVER-NOT: edge Allocation L{{*}} -> Unknown
// # RUN(LINK): link functions layouts mechanisms=all
// # LINK: function f1 {{*}}callers-known one-callee {{*}}result=L
// # LINK: layout L{{*}} changes=[IsFrozen, GainsProperty, GetsAccessor] stays-with-compiled-code
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): unknown;
const debugging = report("begin") === "never";
function make(start: number) { let pos = start; const o = { next: () => pos++, peek: () => pos }; if (debugging) Object.defineProperty(o, "shown", { get: () => pos }); return o; }
const s = make(1);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += s.next() + s.peek();
report(sum);
report("end");
