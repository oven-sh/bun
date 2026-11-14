// answers: without-library
// # a branch that has lost its negation leads its first edge to the side that is written second. What an edge says of the test goes by the number of the edge in the code: behind `if (differs)` the comparison is false and its negation true, on the other side the reverse
// # told returns false on both sides, so no true stands in its code. The values come out of a list, so no copy of a function knows them
// # f1 = told, f2 = named, f3 = twice, f4 = each
// # RUN(FORM): walk f1 mechanisms=none+Folding
// # FORM-LABEL: code f1:Body
// # FORM: [[no]]: false {{*}} = Boolean
// # FORM: [[same]]: {{*}} = StrictEq
// # FORM: Branch [[same]] -> taken
// # FORM-COUNT-2: Return [[no]]
// # RUN(NEVER): walk f1 mechanisms=none+Folding
// # NEVER-NOT: LogicalNot
// # NEVER-NOT: boolean=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 193 of 193 of 193
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const values: unknown[] = [0, 1, "1", "", null, undefined, NaN, true];
function told(a: unknown, b: unknown) { const same = a === b; const differs = !same; const tested = differs; if (tested) return same; return differs; }
function named(a: unknown, b: unknown) { const same = a === b; const differs = !same; if (differs) return "differs " + same + " " + differs; return "same " + same + " " + differs; }
function twice(a: unknown, b: unknown) { const same = a === b; const differs = !same; const again = !differs; if (again) return "same " + same + " " + differs; return "differs " + same + " " + differs; }
function each(f: (a: unknown, b: unknown) => unknown) { for (let i = 0; i < values.length; i++) { for (let j = 0; j < values.length; j++) report(f(values[i], values[j])); } }
each(told);
each(named);
each(twice);
report("end");
