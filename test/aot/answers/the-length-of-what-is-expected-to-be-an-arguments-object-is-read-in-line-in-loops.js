// answers: without-library
// # What arrives at a parameter is an arguments object. The class has no test, so no guess opens and the read of `length` stays a closed read.
// # In a loop the walk says what is expected (f1), and the read holds the cell against the structure that the maker of such objects lays, in line, in front of the stub.
// # Outside of loops nothing is said (f2); nor where lists arrive (f3). Whatever else comes to f1 by a way that nobody sees is answered by the stub as ever.
// # f1 = inLoop, f2 = outside, f3 = ofLists
// # RUN(LOOP): walk f1 mechanisms=all
// # LOOP: PropGet {{*}}key="length" [receiverIsExpectedToBeArguments]
// # RUN(OUTSIDE): walk f2 mechanisms=all
// # OUTSIDE-NOT: receiverIsExpectedToBeArguments
// # OUTSIDE: Return
// # RUN(LISTS): walk f3 mechanisms=all
// # LISTS-NOT: receiverIsExpectedToBeArguments
// # LISTS: Return
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
const upTo = [0, 1, 2, 3, 4];
function inLoop(list) { let sum = 0; for (let i = 0; i < upTo[4]; i++) sum += list.length; return sum; }
function outside(list) { return list.length; }
function ofLists(list) { let sum = 0; for (let i = 0; i < upTo[4]; i++) sum += list.length; return sum; }
function keep() { return arguments; }
const kept = keep(1, 2, 3);
globalThis.handed = [inLoop, outside, ofLists, upTo];
report(inLoop(kept));
report(inLoop(keep()));
report(outside(kept));
report(ofLists([1, 2]));
const unseen = globalThis.handed[0];
report(unseen("text"));
report(unseen([1, 2]));
report(unseen({ length: 7 }));
report(unseen(5) !== unseen(5));
report(unseen(keep));
kept.length = 9;
report(unseen(kept));
delete kept.length;
report(unseen(kept) !== unseen(kept));
report("end");
