// answers: without-library
// # a private name is read twice. With nothing in between the second read is the first. Behind a store through another name, which may be the same object, it is built again
// # the receivers are `any`, so the accesses stay operations and the read is an answer that hangs on its receiver: mayBeSameObject() of AOTWalkKnownWriters.cpp alone says whether the store ends it.
// # behind a PutSlot the walk's own rule for slots (WalkState::invalidateAliasedSlots(), by the two types) ends the field under every name, whatever mayBeSameObject() says, so two reads of a plain field show nothing
// # between the two reads nothing may run other code, which would end everything: a constant is stored, and the sums stand behind both reads
// # f1 = tell, f2 = Box, f3 = twice, f4 = around
// # RUN(ONCE): walk f3 mechanisms=none+Folding+TypedOperations
// # ONCE-LABEL: code f3:Body
// # ONCE: = PrivateGet
// # ONCE-NOT: = PrivateGet
// # RUN(WITHHELD): walk f3 mechanisms=none
// # WITHHELD-LABEL: code f3:Body
// # WITHHELD-COUNT-2: = PrivateGet
// # RUN(AGAIN): walk f4 mechanisms=none+Folding+TypedOperations
// # AGAIN-LABEL: code f4:Body
// # AGAIN: = PrivateGet
// # AGAIN: = PrivateSet
// # AGAIN: = PrivateGet
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none+Folding+TypedOperations $SHELL
// # ALSO1: 9 of 9 of 9
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
class Box { #v = 1; static twice(a: any) { const first = a.#v; const second = a.#v; return first * 100 + second; } static around(a: any, b: any) { const before = a.#v; b.#v = 5; const after = a.#v; return before * 100 + after; } }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
const one = new Box();
tell(() => Box.twice(one));
tell(() => Box.around(new Box(), new Box()));
tell(() => Box.around(one, one));
tell(() => Box.around(one, new Box()));
tell(() => Box.around(new Box(), one));
tell(() => Box.around(new Box(), {}));
tell(() => Box.around({}, one));
tell(() => Box.twice(one));
report("end");
