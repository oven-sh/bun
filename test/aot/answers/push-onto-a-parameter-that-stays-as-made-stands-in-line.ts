// answers: without-library
// # `list.push(x)` on a parameter of which Link proves that whatever arrives stays as its class makes it: the read of the method is a constant behind the check that holds the word against the list, without a closed arm, and the row that asks [Storage, Names] of its receiver sees the same proof: the code of the push stands in line, and no test is built. A list that has left the program is asked, and the frozen one goes that way too: a list whose integrity changes is no longer as its class has made it.
// # f1 = fill, f2 = fillWhatHasLeft
// # RUN(INLINE): walk f1 mechanisms=all-Inlining
// # INLINE-LABEL: code f1:Body
// # INLINE: TryCallInline {{*}}inlineBuiltin=ArrayPush
// # RUN(HELD): walk f1 mechanisms=all-Inlining
// # HELD-LABEL: code f1:Body
// # HELD-COUNT-1: = IsPristine {{*}}aspects=[Storage, Names, CellAlone]
// # HELD-NEXT: CheckProof {{*}}checkedType=true
// # HELD-NOT: = IsPristine
// # RUN(CLOSED): walk f1 mechanisms=all-Inlining
// # CLOSED-NOT: key="push"
// # RUN(NOSTUB): bytes f1:Body mechanisms=all-Inlining
// # NOSTUB-NOT: CallBoxedBuiltin.ArrayPush
// # RUN(ASKED): walk f2 mechanisms=all-Inlining
// # ASKED-LABEL: code f2:Body
// # ASKED: = IsPristine
// # ASKED: TryCallInline {{*}}inlineBuiltin=ArrayPush
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const one: number = +(globalThis as any).nothingIsHere || 1;
function fill(list: number[], from: number): number { for (let i = 0; i < 3; i++) list.push(from + i); return list.length + 0; }
function fillWhatHasLeft(list: number[], from: number): number { for (let i = 0; i < 3; i++) list.push(from + i); return list.length + 0; }
const kept: number[] = [];
report(fill(kept, one));
report(fill(kept, one / 4));
report(kept.join());
const frozen: number[] = [1, 2];
Object.freeze(frozen);
try { report(fillWhatHasLeft(frozen, one)); } catch (e) { report((e as Error).name); }
report(frozen.join());
const handedOut: number[] = [];
(globalThis as any).handedOutOfThisTest = handedOut;
report(fillWhatHasLeft(handedOut, one));
report(handedOut.join());
report("end");
