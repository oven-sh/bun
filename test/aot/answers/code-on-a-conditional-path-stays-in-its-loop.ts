// answers: without-library
// # loop-invariant code is hoisted only from a place that runs on every iteration; out of nested loops it goes all the way
// # f1 = lengthOf, f2 = everyIteration, f3 = someIterations, f4 = nestedLoops, f5 = inlinedConditionally
// # RUN(EVERY): walk f2 mechanisms=all
// # EVERY: = GetStringLength
// # EVERY: isLoopHead=true
// # EVERY-NOT: = GetStringLength
// # RUN(SOME): walk f3 mechanisms=all
// # SOME: code f3:Body
// # SOME-NOT: = GetStringLength
// # SOME: isLoopHead=true
// # SOME: = GetStringLength
// # RUN(NESTED): walk f4 mechanisms=all
// # NESTED: = GetStringLength
// # NESTED: isLoopHead=true
// # NESTED: isLoopHead=true
// # NESTED-NOT: = GetStringLength
// # RUN(INLINED): walk f5 mechanisms=all
// # INLINED: code f5:Body
// # INLINED-NOT: = GetStringLength
// # INLINED: isLoopHead=true
// # INLINED: = GetStringLength
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 33 of 33 of 33
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function everyIteration(text: string, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum = (sum + text.length) | 0; return sum; }
function someIterations(text: string, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { if (i & 1) sum = (sum + text.length) | 0; } return sum; }
function nestedLoops(text: string, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) sum = (sum + text.length) | 0; } return sum; }
function lengthOf(text: string, wanted: boolean): number { if (wanted) return text.length; return 0; }
function inlinedConditionally(text: string, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum = (sum + lengthOf(text, (i & 1) === 1)) | 0; return sum; }
for (let n = 0; n < 8; n++) { report(everyIteration("abc", n)); report(someIterations("abcd", n)); report(nestedLoops("ab", n)); report(inlinedConditionally("abcde", n)); }
report("end");
