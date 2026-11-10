// answers: with-library
// # `for (let i = 0; i < count; i++) total += i`, count a number that nobody has proven whole: the counter went round as an integer of 53 bits, held at 2^53 in every turn, the sum was made in 64 bits and asked whether it fits, and a poll stood
// # in every turn: 13 instructions a turn for `total = (total + i) | 0`. A turn that computes with its counter (a sum or a product takes it that is not its step) takes it as an integer, as a key, a bit operator or an argument does: the loop is
// # built a second time for its bound, the counter an int32 against the lesser of the rounded bound and 2^31 - 1: the loop whose turns the code generator lays out. A counter that no turn reads buys nothing, as before.
// # f1 = cut, f2 = added, f7 = top, f11 = unread
// # RUN(FORM): walk f1 f2 f7 f11 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = IntegerBound {{*}}comparison=Less
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM: @Int32 = Increment {{*}}form=Integers
// # FORM-LABEL: code f2:Body
// # FORM: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM-LABEL: code f7:Body
// # FORM: int[2147483640, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # FORM-LABEL: code f11:Body
// # FORM-NOT: int[0, 2147483647] @Int32) isInLoop=true isLoopHead=true
// # Under bounds of every kind; from 2147483640 on: the last step that is an int32 and the turn that is handed over. At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 28 of 28 of 28
// # CHECK-NEXT: exited with 0
// # RUN(FAILED): run-in-shell $SHELL testing=FailGuesses
// # FAILED: 28 of 28 of 28
// # FAILED-NEXT: exited with 0
// # RUN(CHECKED): run-in-shell $SHELL testing=CheckProofsAtRunTime
// # CHECKED: 28 of 28 of 28
// # CHECKED-NEXT: exited with 0
// # THE LIE, testing=BoundsOfCountersAreRoundedTheOtherWay: the bound is rounded in front of the loop as for <= where the head asks <, and the other way round: under 15.5 and 0.5 a turn too few or too many, in silence. No type is false there.
// # Under the word that checks proofs the typed head holds, in every turn, the relation against the rounded bound to answer as the relation as written.
// # RUN(LIE): run-in-shell $SHELL mechanisms=all testing=BoundsOfCountersAreRoundedTheOtherWay
// # REQUIRES(LIE): as-written
// # LIE: 26 of 28 of 28
// # RUN(STOPPED): run-in-shell $SHELL mechanisms=all testing=CheckProofsAtRunTime,BoundsOfCountersAreRoundedTheOtherWay
// # STOPPED: AOT: f{{*}} at {{*}}: what memory holds where the compiler remembers another value
// # STOPPED-NOT: of 28 of 28
// # STOPPED: crashed with
declare function report(value: unknown): void;
function cut(count: any): number { let total = 0; for (let i = 0; i < count; i++) total = (total + i) | 0; return total; }
function added(count: any): number { let total = 0; for (let i = 0; i < count; i++) total += i; return total; }
function ofNumber(given: any): number { const count = +given; let total = 0.5; for (let i = 0; i < count; i++) total += i; return total; }
function orEqual(count: any): number { let total = 0; for (let i = 0; i <= count; i++) total -= i; return total; }
function multiplied(count: any): number { let total = 0; for (let i = 0; i < count; i++) total = (total + i * 3) | 0; return total; }
function byTwos(count: any): number { let total = 0; for (let i = 0; i < count; i += 2) total += i; return total; }
function top(count: any): string { let total = 0, turns = 0; for (let i = 2147483640; i < count; i++) { total += i; if (++turns === 20) break; } return total + ":" + turns; }
function topCut(count: any): string { let total = 0, turns = 0; for (let i = 2147483640; i < count; i++) { total = (total + i) | 0; if (++turns === 20) break; } return total + ":" + turns; }
function topOrEqual(count: any): string { let total = 0, turns = 0; for (let i = 2147483640; i <= count; i++) { total += i * 2; if (++turns === 20) break; } return total + ":" + turns; }
function topByTwos(count: any): string { let total = 0, turns = 0; for (let i = 2147483640; i < count; i += 2) { total += i; if (++turns === 20) break; } return total + ":" + turns; }
function unread(count: any, k: number): number { let total = 0; for (let i = 0; i < count; i++) total += k; return total; }
const bounds: unknown[] = [0, 1, 7, 8, 9, 17, 15.5, 0.5, -1, -0, NaN, undefined, null, true, "3", "x", -Infinity];
const tops: unknown[] = [2147483640, 2147483641, 2147483646, 2147483647, 2147483648, 2147483649.5, 2147483655, 4294967296, Infinity, NaN];
for (const b of bounds) report([cut(b), added(b), ofNumber(b), orEqual(b), multiplied(b), byTwos(b), unread(b, 0.25)].join(" "));
for (const b of tops) report([top(b), topCut(b), topOrEqual(b), topByTwos(b)].join(" "));
report("end");
