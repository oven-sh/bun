// answers: without-library
// # the value has passed a test for a string and then a test that only turns numbers away: what flows on is a string, and the wider test does not take the place of the narrower
// # f1 = textOnly
// # OPTIONS: testing=CheckProofsAtRunTime
// # RUN(FORM): summary f1
// # FORM: edge Parameter 0 -> Result 0 passes=string
// # RUN(NEVER): summary f1
// # NEVER-NOT: edge Parameter 0 -> Result 0 passes={{*}}undefined
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function textOnly(a: any) { if (typeof a === "string") { if (typeof a !== "number") return a; } return "none"; }
function lengthOf(a: any) { return textOnly(a).length; }
report(lengthOf("three"));
report(lengthOf(3));
report(lengthOf(null));
report("end");
