// answers: without-library
// # Link has seen all that comes out of `list[i]`: numbers, and undefined where the list lacks an element. Where the one reader is an operator on numbers the read gives the number as that takes it: no box is made of a double to be taken apart again. It is one operation as before. Whoever else reads gets the box.
// # f2 = show, f3 = sum, f4 = sumPastTheEnd, f5 = half, f6 = above, f7 = handOn, f1 = keep
// # RUN(SUM): walk f3 mechanisms=all-Inlining-LoopInvariants
// # SUM-LABEL: code f3:Body
// # SUM: [[element]]: undefined|number @OptionalDouble = GetArrayElement {{*}} level=
// # SUM: = Add {{*}}[[element]] form=Numbers
// # RUN(HALF): walk f5 mechanisms=all-Inlining
// # HALF-LABEL: code f5:Body
// # HALF: undefined|number @OptionalDouble = GetArrayElement {{*}} level=
// # RUN(ABOVE): walk f6 mechanisms=all-Inlining-LoopInvariants
// # ABOVE-LABEL: code f6:Body
// # ABOVE: undefined|number @OptionalDouble = GetArrayElement {{*}} level=
// # RUN(HANDED): walk f7 mechanisms=all-Inlining
// # HANDED-LABEL: code f7:Body
// # HANDED: undefined|number @JSValue = GetArrayElement {{*}} level=
// # The stub that the read had answers for whatever has no arm.
// # RUN(STUB): bytes f5:Body mechanisms=all-Inlining
// # STUB: ArrayGetAtIndex.
// # RUN(LOADS): emit f5 mechanisms=all-Inlining
// # LOADS-LABEL: unit f5:Body
// # LOADS: = Load({{*}}indexedDoubleProperties
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 49 of 49 of 49
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const one: number = +(globalThis as any).nothingIsHere || 1;
function show(x: unknown): string { return Object.is(x, -0) ? "-0" : String(x); }
function sum(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
function sumPastTheEnd(list: number[]): number { let s = 0; for (let i = 0; i <= list.length; i++) s += list[i]; return s; }
function half(list: number[], at: number): number { return list[at] / 2; }
function above(list: number[], bound: number): number { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i] > bound) n++; } return n; }
function handOn(list: number[], at: number): unknown { return keep(list[at]); }
function keep(x: unknown): unknown { kept = x; return kept; }
let kept: unknown = 0;
const fractions: number[] = [];
for (let i = 0; i < 6; i++) fractions.push(i + one / 2);
const whole: number[] = [];
for (let i = 0; i < 6; i++) whole.push(i + 1);
const turned: number[] = [];
for (let i = 0; i < 6; i++) turned.push(i + 1);
turned[2] = one / 4;
const holed: number[] = [];
for (let i = 0; i < 6; i++) holed.push(i + one / 2);
holed.length = 3;
holed[5] = one / 2;
const zeros: number[] = [];
for (let i = 0; i < 3; i++) zeros.push(-one * 0);
const none: number[] = [];
report(show(sum(fractions))); report(show(sumPastTheEnd(fractions))); report(show(half(fractions, 0))); report(show(half(fractions, 3))); report(show(half(fractions, 6))); report(show(half(fractions, -1))); report(above(fractions, one)); report(show(handOn(fractions, 2)));
report(show(sum(whole))); report(show(sumPastTheEnd(whole))); report(show(half(whole, 0))); report(show(half(whole, 3))); report(show(half(whole, 6))); report(show(half(whole, -1))); report(above(whole, one)); report(show(handOn(whole, 2)));
report(show(sum(turned))); report(show(sumPastTheEnd(turned))); report(show(half(turned, 0))); report(show(half(turned, 3))); report(show(half(turned, 6))); report(show(half(turned, -1))); report(above(turned, one)); report(show(handOn(turned, 2)));
report(show(sum(holed))); report(show(sumPastTheEnd(holed))); report(show(half(holed, 0))); report(show(half(holed, 3))); report(show(half(holed, 6))); report(show(half(holed, -1))); report(above(holed, one)); report(show(handOn(holed, 2)));
report(show(sum(zeros))); report(show(sumPastTheEnd(zeros))); report(show(half(zeros, 0))); report(show(half(zeros, 3))); report(show(half(zeros, 6))); report(show(half(zeros, -1))); report(above(zeros, one)); report(show(handOn(zeros, 2)));
report(show(sum(none))); report(show(sumPastTheEnd(none))); report(show(half(none, 0))); report(show(half(none, 3))); report(show(half(none, 6))); report(show(half(none, -1))); report(above(none, one)); report(show(handOn(none, 2)));
report("end");
