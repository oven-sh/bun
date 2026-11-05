// answers: with-library
// # Nothing in the program lays a name on the table or puts another object above it, and it never leaves: Link says that it stays as its class has made it, so `names.get` is the method of the engine.
// # In every build that word is held against the table where it is taken: one bit of its cell, and a stop by name where the word is false. There is no closed arm.
// # RUN(HELD): walk f1 mechanisms=all
// # HELD-LABEL: code f1:Body
// # HELD: = IsPristine {{*}}builtinClass=Map aspects=[Names, CellAlone]
// # HELD-NEXT: CheckProof {{*}}checkedType=true
// # HELD: inlineBuiltin=MapGet
// # RUN(CLOSED): walk f1 mechanisms=all
// # CLOSED-NOT: key="get"
// # RUN(HARDENED): walk f1 mechanisms=all testing=CheckProofsAtRunTime
// # HARDENED: = IsPristine {{*}}builtinClass=Map aspects=[Names, CellAlone]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
const names = new Map<string, string>();
function intern(text: string): string { let found = names.get(text); if (found === undefined) { names.set(text, found = text); } return found; }
for (let round = 0; round < 3; round++) for (const word of ["alpha", "beta", "alpha", "gamma"]) report(intern(word + round % 2));
report(names.size);
report("end");
