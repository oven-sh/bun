// answers: without-library
// # Null laid above a literal at its birth lets nobody see the object: it is as fresh as any other literal where the next statement stores into it.
// # So the end of the birth gives it no second name, and the store that creates a field knows that it creates it.
// # f1 = make
// # RUN(WALK): walk f1 mechanisms=all
// # WALK: [[made]]: {{*}} = NewObject
// # WALK: SetLiteralPrototype [[made]],
// # WALK-NOT: = FinishObject
// # WALK: PutSlotOrAdd [[made]], {{*}}key="later" {{*}}[isExpectedToCreate]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): any;
function make(i: number) { const r: any = { __proto__: null, first: i }; r.later = i + 1; return r; }
let sum = 0;
for (let i = 0; i < 100; i++) { const r = make(i); sum += r.first + r.later; }
report(sum);
report(Object.keys(make(1)).join());
report(Object.getPrototypeOf(make(2)) === null);
report("end");
