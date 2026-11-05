// answers: without-library
// # `text = text + "b"` in a loop that is built twice: the text goes round in a string builder, which is begun at the head, behind the looks. The head of the other copy takes no builder, so no turn begins again,
// # and the read behind a look at its slot keeps its closed arm. The look that is tried for the typed copy says the same: under the verifier the walk stops where something is built in a loop that the looks have not counted on.
// # OPTIONS: check=Validate
// # f1 = id, f2 = grows
// # RUN(FORM): walk f1 f2 mechanisms=all-ParameterGuards
// # FORM: = StackStringBuilderBegin
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
type Box = { x: number };
function grows(o: Box, n: number): string { let text = "a"; let i = 0; while (true) { if (i >= n) break; if (o.x === i) break; text = text + "b"; i++; } return text + i; }
id(grows);
report(grows(id({ x: 3 }), 9));
report(grows(id({ x: 30 }), 4));
report(grows(id({ y: 0, x: 2 }) as any, 9));
report(grows((0, eval)("({ get x() { return 1; } })"), 9));
report("end");
