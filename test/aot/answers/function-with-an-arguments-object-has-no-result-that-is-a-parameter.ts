// answers: without-library
// # a body that has an arguments object may store into a parameter where no operation shows it (a sloppy one does), so the scan lists none of its results as a parameter, though the only edge to the result comes from one
// # f1 = kept
// # OPTIONS: testing=CheckProofsAtRunTime
// # RUN(FORM): summary f1
// # FORM: summary f1 {{*}}UsesArguments
// # FORM: edge Parameter {{*}} -> Result 0
// # RUN(NEVER): summary f1
// # NEVER-NOT: result 0 is
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function kept(x: any) { arguments[0] = "stored"; return x; }
function number() { return typeof kept(1); }
function text() { return typeof kept("a"); }
report(number());
report(text());
report("end");
