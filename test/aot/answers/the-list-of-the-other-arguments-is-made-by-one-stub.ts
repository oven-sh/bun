// answers: with-library
// # A function that takes `...rest`, entered by value: its entry hands the count of the other arguments and the place where they lie side by side to ONE stub, which makes the list and copies them:
// # no loop, no allocation and no call of the run time stands in the entry itself.
// # f1 = all, f2 = behindOne, f3 = behindTwo
// # RUN(LISTS): bytes f1:GenericCallEntry f2:GenericCallEntry f3:GenericCallEntry mechanisms=all
// # LISTS-LABEL: unit f1:GenericCallEntry
// # LISTS-NOT: NewArrayWithLength
// # LISTS-NOT: operationAOTNewArray
// # LISTS: Stub NewArrayFromBuffer
// # LISTS-LABEL: unit f2:GenericCallEntry
// # LISTS-NOT: NewArrayWithLength
// # LISTS-NOT: operationAOTNewArray
// # LISTS: Stub NewArrayFromBuffer
// # LISTS-LABEL: unit f3:GenericCallEntry
// # LISTS-NOT: NewArrayWithLength
// # LISTS-NOT: operationAOTNewArray
// # LISTS: Stub NewArrayFromBuffer
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 73 of 73 of 73
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 73 of 73 of 73
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function all(...rest: unknown[]) { return rest.length + ":" + rest.join(); }
function behindOne(first: unknown, ...rest: unknown[]) { return String(first) + "|" + rest.length + ":" + rest.join(); }
function behindTwo(this: unknown, first: unknown, second: unknown, ...rest: unknown[]) { return String(this) + "|" + String(first) + "|" + String(second) + "|" + rest.length + ":" + rest.join(); }
const taken: ((...given: unknown[]) => unknown)[] = [all, behindOne, behindTwo];
function few(called: (...given: unknown[]) => unknown) { report(called()); report(called(1)); report(called(1, "two")); report(called(1, "two", 3.5)); report(called(1, "two", 3.5, null)); }
function more(called: (...given: unknown[]) => unknown) { report(called(1, "two", 3.5, null, undefined)); report(called(1, "two", 3.5, null, undefined, true, 7, 8, 9)); report(called.call("receiver", 1, 2, 3, 4, 5, 6)); }
for (let turn = 0; turn < 3; turn++) { for (let which = 0; which < 3; which++) { few(taken[which]); more(taken[which]); } }
report("end");
