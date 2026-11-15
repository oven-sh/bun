// answers: without-library
// # A pattern literal with the flag y makes a new object each time it is evaluated: every replacement starts at the first character.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
function cut(seed: number): string { const text = "aab" + seed; const pattern = /a+/y; return text.replace(pattern, "-"); }
report(cut(1)); report(cut(2)); report(cut(3));
report("end");
declare function report(value: unknown): void;
