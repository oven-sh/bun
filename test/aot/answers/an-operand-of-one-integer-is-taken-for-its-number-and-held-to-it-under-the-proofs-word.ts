// answers: with-library
// # `list[i] * k`, k proven to be the one integer 7: arithmetic on numbers takes 7 and never reads k. Under testing=CheckProofsAtRunTime k was read as it comes: another form than the one that ships, which held nothing and hid a false type.
// # Under the word k is now read, held against 7, and 7 is taken. The two short forms of a remainder are counted: a dividend below twice the divisor, and a divisor of one integer.
// # STATISTIC: RemaindersOfDividendsBelowTwiceTheDivisor >= 1
// # STATISTIC: RemaindersByDivisorsOfOneInteger >= 1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
// # RUN(PROOFS): run-in-shell testing=CheckProofsAtRunTime $SHELL
// # PROOFS: 5 of 5 of 5
// # PROOFS-NEXT: exited with 0
declare function report(value: unknown): void;
function scale(list: number[], on: boolean): number { const k = on ? 7 : 7; let s = 0.5; for (let i = 0; i < list.length; i++) s = s + list[i]! * k; return s; }
function half(x: number): number { const two = 2; return x / two + 0.25; }
function spin(turns: number): string { let head = 0, sum = 0; for (let i = 0; i < turns; i++) { head = (head + 1) % 1000; sum = (sum + head) | 0; } return head + " " + sum; }
const list: number[] = [];
for (let i = 0; i < 6; i++) list.push(i + 0.5);
report(scale(list, list.length > 3));
report(scale(list, list.length > 9));
report(half(list[2]! + 0.125));
report(spin(2500));
report("end");
