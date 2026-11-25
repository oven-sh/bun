// answers: without-library
// # turns() calls its parameter. Link's effects of it given its arguments leave out what the closure does: the caller adds that (findHalvesGivenArgumentsForKnownEffects()). The walk copies the one closure that the parameter's type names into the body,
// # and the verifier of the unit (EffectsNotCounted) held the copied store against the half that leaves it out.
// # f1 = turns
// # OPTIONS: check=Validate
// # RUN(LINK): link functions mechanisms=all
// # LINK: function f1 {{*}}mayCallUnknownCode
// # LINK: given-arguments called=[0]
// # RUN(WALK): walk f1 mechanisms=all
// # WALK: frame 1 callee=f
// # WALK: = PutEnvironmentField
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
function turns(step, n) { let sum = 0; for (let i = 0; i < n; i++) sum += step(i); return sum; }
function count() { let seen = 0; const total = turns((i) => { seen = seen + 1; return i; }, 3); return total * 10 + seen; }
report(count());
report("end");
