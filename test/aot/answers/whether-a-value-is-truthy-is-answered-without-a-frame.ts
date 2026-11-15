// answers: with-library
// # The stubs that answer whether any value is truthy answer for a big integer themselves: its length is not zero. So they never leave the stubs,
// # a function that only asks them needs no frame, and one that asks and returns at once sets its frame up behind the question.
// # RUN(BRANCHES): allocate f1:Body mechanisms=all
// # REQUIRES(BRANCHES): x86_64 as-written
// # BRANCHES-NOT: needsFrameOutsideRareRegions
// # RUN(ANSWERS): allocate f2:Body mechanisms=all
// # REQUIRES(ANSWERS): x86_64 as-written
// # ANSWERS-NOT: needsFrameOutsideRareRegions
// # RUN(EARLY): allocate f3:Body mechanisms=all
// # REQUIRES(EARLY): x86_64 as-written
// # EARLY: headOfFramedPart =
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function branches(value: unknown): number { if (value) return 1; return 2; }
function answers(value: unknown): boolean { return !!value; }
function returnsEarly(value: unknown, list: unknown[]): number { if (!value) return -1; return list.push(value); }
(globalThis as any).kept = [branches, answers, returnsEarly];
const given: unknown[] = JSON.parse('[0, 1, -1, 0.5, "", "x", " ", null, true, false, {}, [], [0], 1e300]');
given.push(undefined);
given.push(NaN);
given.push(-0);
given.push(Infinity);
given.push(Symbol("s"));
given.push(() => 0);
given.push(0n);
given.push(1n);
given.push(-1n);
given.push(-0n);
given.push(2n ** 64n);
given.push(2n ** 64n - 2n ** 64n);
given.push(BigInt(0));
given.push(BigInt("0"));
given.push(BigInt.asUintN(64, -1n));
given.push(BigInt.asUintN(8, 256n));
given.push(BigInt.asIntN(1, 2n));
given.push(5n * 0n);
given.push(7n / 8n);
given.push(new String(""));
given.push(new Boolean(false));
given.push(Object(0n));
const kept: unknown[] = [];
let text = "";
for (const value of given) text += branches(value) + (answers(value) ? "t" : "f") + returnsEarly(value, kept) + " ";
report([text].join(" "));
report([kept.length].join(" "));
report("end");
