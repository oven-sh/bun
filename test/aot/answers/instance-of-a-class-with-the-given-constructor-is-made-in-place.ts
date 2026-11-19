// answers: without-library
// # `class Given extends Plain { stamp = 7 }` has `constructor(...args) { super(...args); }`: copied, its list is known, `super(...args)` is `super()`, and the constructor above is copied in its place: one allocation of the class that is constructed, with both fields.
// # RUN(FORM): walk f1 mechanisms=all
// # FORM: NewObject {{*}}layout=L1 fields=[
// # FORM-NOT: PutSlotOrAdd
// # RUN(NEVER): walk f1 mechanisms=all
// # NEVER: isInLoop=true isLoopHead=true
// # NEVER-NOT: SuperConstruct
// # NEVER-NOT: NewArray
// # NEVER-NOT: CallDirect
// # NEVER-NOT: ShapeTest
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
class Plain { id = 1; }
class Given extends Plain { stamp = 7; }
const kept: Given[] = new Array(8);
function make(turns: number): number { let sum = 0; for (let i = 0; i < turns; i++) { const made = new Given(); kept[i & 7] = made; sum += made.id + made.stamp; } return sum; }
report(make(1000));
report(kept[3] instanceof Given);
report(Object.keys(kept[3]).join());
report("end");
declare function report(value: unknown): void;
