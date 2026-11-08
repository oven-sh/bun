// answers: without-library
// # The variable of a function declaration is born as its function: its word is zero until something is stored, and zero stands for the one closure that the function has.
// # Where the read is proven to give closures of that function alone, nothing else was ever stored: the word is not loaded and not tested, and the closure comes out of its cell of the closure table.
// # Where a store may have put another function there, or undefined or null (which are no objects of the type), the word is asked as before.
// # f1 = plain, f2 = replaced, f3 = other, f5 = handPlain, f6 = handReplaced, f9 = handCleared
// # RUN(FORM): bytes f5:Body f6:Body f9:Body mechanisms=all
// # FORM-LABEL: unit f5:Body
// # FORM-NOT: InstanceWord Variable "plain"
// # FORM: ClosureCell
// # FORM-NOT: InstanceWord Variable "plain"
// # FORM-LABEL: unit f6:Body
// # FORM: InstanceWord Variable "replaced"
// # FORM-LABEL: unit f9:Body
// # FORM: InstanceWord Variable "cleared"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
function plain(n) { return n + 1; }
function replaced(n) { return n + 2; }
function other(n) { return n * 10; }
function handPlain() { return plain; }
function handReplaced() { return replaced; }
function swap() { replaced = other; }
function each(list, f) { let sum = 0; for (let i = 0; i < list.length; i++) sum += f(list[i]); return sum; }
function cleared(n) { return n + 3; }
function handCleared() { return cleared; }
function clear(to) { cleared = to; }
report(handPlain()(1));
report(handPlain() === plain);
report(handPlain() === handPlain());
report(handPlain().name + " " + handPlain().length);
report(each([1, 2, 3], plain));
report(handReplaced()(1));
report(handReplaced() === replaced);
swap();
report(handReplaced()(1));
report(handReplaced() === other);
report(each([1, 2, 3], replaced));
handPlain().mark = 5;
report(plain.mark);
report(handCleared()(1));
clear(undefined);
report(handCleared());
report(typeof handCleared());
clear(null);
report(handCleared());
report(handCleared() === null);
report("end");
