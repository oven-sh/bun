// answers: without-library
// # In a loop whose counter is bounded by something else than the view's length a read may lie outside, and gives undefined there. Where the loop is built twice and the turn may still begin again,
// # the walk asks once, `position < length`, and reads behind the test: inside, the read gives the number alone, so the sum stays in integers; outside, the turn begins again in the closed copy of the loop.
// # The guess takes the read alone: no stretch is looked for and no arm is walked, so N reads in one block cost N.
// # f1 = wrapped, f2 = plain
// # RUN(WRAPPED): walk f1 mechanisms=all
// # WRAPPED: = GetTypedArrayElement {{*}}isInsideView
// # RUN(PLAIN): walk f2 mechanisms=all
// # PLAIN: = GetTypedArrayElement {{*}}isInsideView
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 15 of 15 of 15
// # CHECK-NEXT: exited with 0
class Holder { view: Int32Array = new Int32Array(4); }
function wrapped(holder: Holder, n: number): number { const view = holder.view; let sum = 0; for (let i = 0; i < n; i++) sum = (sum + view[i]) | 0; return sum; }
function plain(holder: Holder, n: number): number { const view = holder.view; let sum = 0; for (let i = 0; i < n; i++) sum += view[i]; return sum; }
const holder = new Holder();
for (let i = 0; i < 4; i++) holder.view[i] = (i + 1) * 5;
report(typeof report(holder as unknown as string));
const bounds = [0, 1, 3, 4, 5, 9];
for (let at = 0; at < bounds.length; at++) { report(wrapped(holder, bounds[at])); report(plain(holder, bounds[at])); }
report("end");
