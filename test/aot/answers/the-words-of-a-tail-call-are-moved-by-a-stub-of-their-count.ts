// answers: with-library
// # A unit that leaves by a call which passes more words on the stack than its own caller left room for: an entry by value of a closure with ten captures, a function of two parameters that ends in a call with eleven arguments.
// # The words lie at the top of its frame; finding the frame of lists to reuse and moving them there is the work of ONE stub for each count of words: the unit itself only names the callee and jumps.
// # f1 = eleven, f2 = few, f3 = make, f4 = first, f5 = second
// # RUN(WORDS): bytes f2:Body f4:GenericCallEntry f5:GenericCallEntry mechanisms=-Inlining
// # WORDS-LABEL: unit f2:Body
// # WORDS: Jump Stub CallFromArgumentListFrameWithWords.NothingAboveFrameRecord count
// # WORDS-LABEL: unit f4:GenericCallEntry
// # WORDS: Jump Stub CallFromArgumentListFrameWithWords.NothingAboveFrameRecord count 3
// # WORDS-LABEL: unit f5:GenericCallEntry
// # WORDS: Jump Stub CallFromArgumentListFrameWithWords.ArgumentRegistersAboveFrameRecord count 3
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 28 of 28 of 28
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Inlining $SHELL
// # ALSO1: 28 of 28 of 28
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
function make(seed: number) { const a = seed + 1, b = seed + 2, c = seed + 3, d = seed + 4, e = seed + 5, f = seed + 6, g = seed + 7, h = seed + 8, i = seed + 9, j = seed + 10; return [function first(x: number) { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + x * 100; }, function second(...rest: number[]) { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10 + rest.length * 100; }]; }
function eleven(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number): number { return a <= 0 ? b + c * 2 + d * 3 + e * 4 + f * 5 + g * 6 + h * 7 + i * 8 + j * 9 + k * 10 : few(a - 1, b + k); }
function few(left: number, sum: number): number { return eleven(left, sum % 1000003, 1, 2, 3, 4, 5, 6, 7, 8, 9); }
const made = [...make(0), ...make(50)];
for (let turn = 0; turn < 3; turn++) { for (let which = 0; which < 4; which++) { report(made[which](1)); report(made[which](2, 3)); } }
report(few(0, 1)); report(few(1, 1)); report(few(100000, 1));
report("end");
