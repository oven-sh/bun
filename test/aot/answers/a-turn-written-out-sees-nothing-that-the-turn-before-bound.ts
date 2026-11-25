// answers: without-library
// # `const a = list[k]; const b: any = k === 0 ? 1 : "x"; a + b` in an inner loop whose two turns are written out, over a list with a hole. The read of `list[k]` looks AHEAD at the other operand of its one user.
// # Once Frame::references kept what the turn before had bound: in the second turn the look found the Integer 1 of the first, took the hole for NaN, and the sum spelled "NaNx" for "undefinedx": 0 hits for 300.
// # f1 = id, f2 = count, f3 = left, f4 = numbers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
function count(list: number[], rounds: number): number { let hits = 0; for (let r = 0; r < rounds; r++) { for (let k = 0; k < 2; k++) { if (k < list.length) { const a = list[k]; const b: any = k === 0 ? 1 : "x"; if (a + b === "undefinedx") hits++; } } } return hits; }
function left(list: number[], rounds: number): number { let hits = 0; for (let r = 0; r < rounds; r++) { for (let k = 0; k < 2; k++) { if (k < list.length) { const a = list[k]; const b: any = k === 0 ? 1 : "x"; if (b + a === "xundefined") hits++; } } } return hits; }
function numbers(list: number[], rounds: number): number { let holes = 0; for (let r = 0; r < rounds; r++) { for (let k = 0; k < 2; k++) { if (k < list.length) { const b = k === 0 ? 1 : 2; const joined = list[k] + b; if (joined !== joined) holes++; } } } return holes; }
const holed: number[] = [1, 2, 3];
delete holed[1];
const whole: number[] = [1, 2, 3];
report(count(id(holed), 300));
report(count(id(whole), 300));
report(left(id(holed), 300));
report(left(id(whole), 300));
report(numbers(id(holed), 300));
report(numbers(id(whole), 300));
report("end");
