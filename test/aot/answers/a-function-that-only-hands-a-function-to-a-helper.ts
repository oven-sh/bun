// answers: without-library
// # `function gatheredMarks(crate) { return gathered(crate, marksOf); }`: all that it does is to hand a function of the program to a helper that only calls it: the program's own version of the helper for that function.
// # f1 = gathered, f2 = marksOf, f3 = sortOf, f4 = gatheredMarks, f5 = gatheredSorts, f6 = both, f7 = inTurns, f8 = gatheredSums
// # In its own body the helper is copied, and no call by value is left.
// # RUN(VERSION): walk f4 mechanisms=all
// # VERSION-LABEL: code f4:Body
// # VERSION: callee=f1
// # VERSION-NOT: = Call v
// # Outside of loops it is called where it is written: copied, it would be a call of the one body that the helper has for all.
// # RUN(CALLER): walk f6 mechanisms=all
// # CALLER-LABEL: code f6:Body
// # CALLER: CallDirect {{*}} function=f4
// # CALLER: CallDirect {{*}} function=f5
// # CALLER-NOT: function=f1
// # In a loop both are copied, as before.
// # RUN(TURNS): walk f7 mechanisms=all
// # TURNS-LABEL: code f7:Body
// # TURNS-NOT: function=f4
// # TURNS-NOT: = Call v
// # A function that is written in place: the copy takes it, and no closure is made.
// # RUN(INPLACE): walk f8 mechanisms=all
// # INPLACE-LABEL: code f8:Body
// # INPLACE: callee=f1
// # INPLACE-NOT: = NewClosure
// # INPLACE-NOT: = Call v
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
type Crate = { marks: number; sort: number; outer: Crate | undefined };
function gathered(crate: Crate, ask: (c: Crate) => number): number { const own = ask(crate); const around = crate.outer; if (around === undefined || crate.sort === 0) return own; return around.sort === 2 && around.outer ? own | ask(around) | ask(around.outer) : own | ask(around); }
function marksOf(crate: Crate): number { return crate.marks; }
function sortOf(crate: Crate): number { return crate.sort; }
function gatheredMarks(crate: Crate): number { return gathered(crate, marksOf); }
function gatheredSorts(crate: Crate): number { return gathered(crate, sortOf); }
function both(crate: Crate): number { return gatheredMarks(crate) * 100 + gatheredSorts(crate); }
function inTurns(crates: Crate[]): number { let sum = 0; for (let i = 0; i < crates.length; i++) sum += gatheredMarks(crates[i]); return sum; }
function gatheredSums(crate: Crate, more: number): number { return gathered(crate, (c: Crate): number => c.marks + more); }
const ship: Crate = { marks: 1, sort: 0, outer: undefined };
const hold: Crate = { marks: 2, sort: 2, outer: ship };
const box: Crate = { marks: 4, sort: 1, outer: hold };
report(both(ship));
report(both(hold));
report(both(box));
report(inTurns([ship, hold, box]));
report(gatheredSums(box, 8));
report("end");
