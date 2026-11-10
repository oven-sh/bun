// answers: without-library
// # A wrapper hands its rest list, or a list that it writes, to `apply`, and nobody knows who is called. In the copy in line the list is fresh and its elements are in sight:
// # behind the test that `apply` is the built-in the call takes the elements themselves (Call, no CallList), and no list is made on that way.
// # The rare arm, where the function has an `apply` of its own, makes the list for itself.
// # f1 = byRest, f2 = byLiteral
// # RUN(REST): walk f1 mechanisms=all
// # REST: TypeTest {{*}}testedType=builtin(FunctionPrototypeApply)
// # REST-NOT: CallList
// # REST-COUNT-1: = NewArray
// # RUN(LITERAL): walk f2 mechanisms=all
// # LITERAL: TypeTest {{*}}testedType=builtin(FunctionPrototypeApply)
// # LITERAL-NOT: CallList
// # LITERAL-COUNT-1: = NewArray
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
function byRest(turn) { let sum = 0; for (let i = 0; i < 4; i++) sum += rested(turn, i); return sum; }
function byLiteral(turn) { let sum = 0; for (let i = 0; i < 4; i++) sum += written(turn, i); return sum; }
const table = { add(a, b) { return a + b; }, first(a) { return a; } };
const pick = [String("add")];
const wrapRest = fn => function (...args) { return fn.apply(this, args); };
const wrapWritten = fn => function (a, b) { return fn.apply(this, [a, b]); };
const rested = wrapRest(table[pick[0]]);
const written = wrapWritten(table[pick[0]]);
globalThis.handed = [byRest, byLiteral, table, pick];
for (let turn = 0; turn < 3; turn++) report(byRest(turn));
for (let turn = 0; turn < 3; turn++) report(byLiteral(turn));
report("end");
