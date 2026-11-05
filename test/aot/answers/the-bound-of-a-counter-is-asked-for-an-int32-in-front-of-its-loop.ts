// answers: without-library
// # `for (let i = 0; i < n; i++)` with n a number: the counter is bounded by a number only, so `i * 2` may leave the whole numbers that a double holds and went through doubles.
// # Where the loop is built twice anyway (here the view is asked for in front of it) the bound is asked for an int32 there too: in the typed copy the counter, its product and its step are integers.
// # A bound with a fraction, NaN or one beyond an int32 takes the closed copy.
// # f1 = strided
// # RUN(STRIDED): walk f1 mechanisms=all
// # STRIDED: = TypeTest {{*}}testedType=i32
// # STRIDED: = Mul {{*}}form=Integers
// # STRIDED: = Increment {{*}}form=Integers
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
class Holder { view: Int32Array = new Int32Array(8); }
function strided(holder: Holder, n: number): number { const view = holder.view; let sum = 0; for (let i = 0; i < n; i++) { const o = i * 2; sum = (sum + view[o]) | 0; } return sum; }
const holder = new Holder();
for (let i = 0; i < 8; i++) holder.view[i] = (i + 1) * 5;
report(typeof report(holder as unknown as string));
const bounds = [0, 1, 3, 4, 2.5, 0 / 0, -1, 6];
for (let at = 0; at < bounds.length; at++) report(strided(holder, bounds[at]));
report("end");
