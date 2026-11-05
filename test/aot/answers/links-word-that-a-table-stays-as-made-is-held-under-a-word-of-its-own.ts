// answers: with-library
// # Nothing in the program lays a name on the table or puts another object above it, and it never leaves: Link says that it stays as its class has made it, so `names.get` is the method of the engine.
// # Under the testing word HoldsObjectsToStayingAsMade, which our lanes and fuzzers set and no hardening name stands for, that word is held against the table where it is taken: a test and a stop by name.
// # As built, and under CheckProofsAtRunTime, which --aot-harden=proof-checks turns on, it is believed: the word of Link is known to be false in shapes that harm no answer, and a stop would kill right programs.
// # RUN(HELD): walk f1 mechanisms=all testing=HoldsObjectsToStayingAsMade
// # HELD-LABEL: code f1:Body
// # HELD: = IsPristine {{*}}builtinClass=Map
// # HELD: CheckProof {{*}}checkedType=true
// # HELD: inlineBuiltin=MapGet
// # RUN(BUILT): walk f1 mechanisms=all
// # BUILT-NOT: IsPristine
// # RUN(HARDENED): walk f1 mechanisms=all testing=CheckProofsAtRunTime
// # HARDENED-NOT: IsPristine
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
const names = new Map<string, string>();
function intern(text: string): string { let found = names.get(text); if (found === undefined) { names.set(text, found = text); } return found; }
for (let round = 0; round < 3; round++) for (const word of ["alpha", "beta", "alpha", "gamma"]) report(intern(word + round % 2));
report(names.size);
report("end");
