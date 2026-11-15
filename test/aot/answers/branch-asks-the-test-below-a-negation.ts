// answers: without-library
// # a branch on a negation asks the test below it with its sides changed round: every kind of value takes the side that the program writes
// # a front end asks each value for its truth, so from source a ToBoolean stands on either side of the negation, and a Box too where typed operations are withheld. A negation that is read again stays, and the branch still asks the test
// # f1 = pick, f2 = twice, f3 = falsy, f4 = both, f5 = thrice, f6 = each
// # RUN(FORM): walk f1 mechanisms=none+Folding
// # FORM-LABEL: code f1:Body
// # FORM: [[test]]: {{*}} = TypeTest
// # FORM: Branch [[test]] -> taken
// # RUN(GONE): walk f1 f2 f3 f5 mechanisms=none+Folding
// # GONE-NOT: LogicalNot
// # RUN(TYPED): walk f1 mechanisms=all
// # TYPED-LABEL: code f1:Body
// # TYPED: [[test]]: {{*}} = TypeTest
// # TYPED: Branch [[test]] -> taken
// # RUN(TYPEDGONE): walk f1 f2 f3 f5 mechanisms=all
// # TYPEDGONE-NOT: LogicalNot
// # RUN(WRITTEN): walk f1 mechanisms=none
// # WRITTEN-LABEL: code f1:Body
// # WRITTEN: = LogicalNot
// # RUN(KEPT): walk f4 mechanisms=none+Folding
// # KEPT-LABEL: code f4:Body
// # KEPT: = LogicalNot
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 51 of 51 of 51
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function pick(v: unknown) { const no = !(typeof v === "string"); if (no) return "other"; return "text"; }
function twice(v: unknown) { const yes = !!(typeof v === "string"); if (yes) return "text"; return "other"; }
function falsy(v: unknown) { const no = !v; if (no) return "falsy"; return "truthy"; }
function both(v: unknown) { const no = !v; const text = no ? "falsy" : "truthy"; return text + String(no); }
function thrice(v: unknown) { const no = !!!v; let turns = 0; while (no) { turns++; if (turns > 2) break; } return turns; }
function each(f: (v: unknown) => unknown) { report(f("a")); report(f("")); report(f(1)); report(f(0)); report(f(-0)); report(f(NaN)); report(f(null)); report(f(undefined)); report(f({})); report(f(0n)); }
each(pick);
each(twice);
each(falsy);
each(both);
each(thrice);
report("end");
