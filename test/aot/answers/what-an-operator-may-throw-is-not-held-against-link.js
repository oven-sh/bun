// answers: without-library
// # `undefined|string < "b"` throws by no rule of the language. Link says so of the function; the walk's rule for operators is the wider one and leaves the bit on the operation.
// # The verifier of a unit, which holds the body against Link's effects (EffectsNotCounted), stopped on it: neither rule shows the other false.
// # f1 = below
// # OPTIONS: check=Validate
// # RUN(LINK): link functions mechanisms=all
// # LINK: function f1 {{*}}returns=[mayThrow, mayCollect
// # RUN(WALK): walk f1 mechanisms=all
// # WALK: = Less {{*}}mayThrowByRule
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
function below(text) { return text < "b"; }
let sum = 0;
if (below(undefined)) sum += 1;
if (below("ab")) sum += 10;
if (below("zz")) sum += 100;
report(sum);
report("end");
