// answers: without-library
// # a RegExp that a module only stores is made by the first read of its variable; where that read stands in a loop that calls nothing, or in a reader that is copied into one, every turn finds the RegExp that the first turn made
// # f1 = same, f2 = readOther, f3 = sameThroughCallee, f4 = tell
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: isLoopHead=true
// # FORM: = GetModuleVariable
// # FORM: = NewRegExp
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
const pattern = /a+/;
const other = /b+/;
function same(n: number) { let first: unknown = null; let count = 0; for (let i = 0; i < n; i++) { const now = pattern; if (first === null) first = now; if (first === now) count++; } return count; }
function readOther() { return other; }
function sameThroughCallee(n: number) { let first: unknown = null; let count = 0; for (let i = 0; i < n; i++) { const now = readOther(); if (first === null) first = now; if (first === now) count++; } return count; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => same(0));
tell(() => same(5));
tell(() => same(3));
tell(() => sameThroughCallee(0));
tell(() => sameThroughCallee(5));
tell(() => readOther() === readOther());
report("end");
