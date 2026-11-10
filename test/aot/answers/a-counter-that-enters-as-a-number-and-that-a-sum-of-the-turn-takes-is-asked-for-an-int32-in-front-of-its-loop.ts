// answers: with-library
// # `for (let i = count; i > 0; i--) total = (total + i) | 0`, count a number that nobody has proven whole: the counter ENTERS as a number. It is asked for an int32 once in front of the loop where the turns take it as an integer; a sum or a
// # product that takes it counts as taking, as a key, a bit operator or an argument does: 12 instructions and 5 cycles a turn became 1.4 and 1. What enters is of every kind, and the counter leaves the int32s at either end.
// # f1 = downCut, f2 = downSum
// # RUN(FORM): walk f1 f2 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: @Int32) isInLoop=true isLoopHead=true
// # FORM: @Int32 = Decrement {{*}}form=
// # FORM-LABEL: code f2:Body
// # FORM: @Int32) isInLoop=true isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 36 of 36 of 36
// # CHECK-NEXT: exited with 0
// # RUN(FAILED): run-in-shell $SHELL testing=FailGuesses
// # FAILED: 36 of 36 of 36
// # FAILED-NEXT: exited with 0
// # RUN(CHECKED): run-in-shell $SHELL testing=CheckProofsAtRunTime
// # CHECKED: 36 of 36 of 36
// # CHECKED-NEXT: exited with 0
declare function report(value: unknown): void;
function downCut(from: any): string { let total = 0, turns = 0; for (let i = from; i > 0; i--) { total = (total + i) | 0; if (++turns === 40) break; } return total + ":" + turns; }
function downSum(from: any): string { let total = 0, turns = 0; for (let i = from - 1; i >= 0; i--) { total += i; if (++turns === 40) break; } return total + ":" + turns; }
function downTo(from: any, least: any): string { let total = 0, turns = 0; for (let w = from; w >= least; w--) { total = (total + (w - least)) | 0; if (++turns === 40) break; } return total + ":" + turns; }
function downByTwos(from: any): string { let total = 0, turns = 0; for (let i = from; i > -5; i -= 2) { total += i * 3; if (++turns === 40) break; } return total + ":" + turns; }
function upFrom(from: any, count: any): string { let total = 0, turns = 0; for (let i = from; i < count; i++) { total += i; if (++turns === 40) break; } return total + ":" + turns; }
function whole(from: number): number { let total = 0; for (let i = from; i > 0; i--) total += i; return total; }
const starts: unknown[] = [0, 1, 7, 8, 9, 17, 41, 15.5, 0.5, -1, -0, NaN, undefined, null, true, "3", "x", Infinity, -Infinity, 2147483647, 2147483648, 2147483650.5, 4294967296, 9007199254740992, -2147483648];
for (const s of starts) report([downCut(s), downSum(s), downTo(s, 3), downTo(s, 2.5), downByTwos(s), upFrom(s, 20), upFrom(s, 2147483660)].join(" "));
for (const s of [-2147483640, -2147483647, -2147483648, -2147483649, -2147483630.5]) report([downTo(s, -2147483660), downTo(s, -Infinity), downTo(s, "-2147483655")].join(" "));
for (const s of [0, 1, 8, 1003, 15.5]) report(whole(s));
report("end");
