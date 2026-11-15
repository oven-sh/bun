// answers: without-library
// # `testaot why-closed` says of each call that is built closed what its subject is, how far the walk came and why no further
// # f3 = gather, f4 = add, f5 = pick, f6 = callIt, f1 = first, f2 = second
// # RUN(APART): why-closed f3:Body mechanisms=all
// # APART: Call by value of a method{{*}}PROVEN, A BUILT-IN'S METHOD{{*}}in a loop{{*}}push
// # RUN(NAMED): why-closed f4:Body mechanisms=all
// # NAMED: Call by name{{*}}closed arm of a guess{{*}}push
// # RUN(VALUE): why-closed f6:Body mechanisms=all
// # VALUE: Call by value{{*}}an entry parameter
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
// The list leaves the program, so nobody can say that it stays as its class makes it: else the method is called without a look at the receiver (receivers-that-stay-as-made-by-the-site-1).
function gather(from: number[], f: (x: number) => number): number[] { const result: number[] = []; (globalThis as any).gatheredInThisTest = result; for (let i = 0; i < from.length; i++) result.push(f(from[i])); return result; }
function add(list: number[], v: number): number { const length = list.push(v); return length + 0; }
function pick(which: boolean): (x: number) => number { return which ? first : second; }
function callIt(f: any, x: number): number { const answer = f(x); return answer + 0; }
function first(x: number): number { return x + 1; }
function second(x: number): number { return x * 2; }
report(gather([1, 2, 3], pick(true)).join());
report(gather([1, 2, 3], pick(false)).join());
// The list has left the program, so nobody can say that it stays as its class makes it: else the call is open and there is no line (instances-that-stay-as-made-1).
const handedOut = [1];
(globalThis as any).handedOutOfThisTest = handedOut;
report(add(handedOut, 2));
report(callIt(pick(true), 4));
report(callIt(pick(false), 4));
report(callIt(Math.abs, -4));
report("end");
