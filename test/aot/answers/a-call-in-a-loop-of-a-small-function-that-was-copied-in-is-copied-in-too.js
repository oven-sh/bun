// answers: with-library
// # run() is small and is copied in where it is called in a loop. Its own loop calls step(): in run's own unit that call is copied in. Inside the copy it gets the same: else copying the small outer function would lose the copy of the inner one, and every step would be a call.
// # f1 = Reader, f2 = step, f3 = run, f4 = total
// # RUN(WALK): walk f4 mechanisms=all
// # WALK: frame {{*}}callee=f3
// # WALK: frame {{*}}callee=f2 {{*}}parent=
// # The position comes round the loop as an int32: the version for other numbers is rare and calls.
// # WALK: frequency=Rare isLoopHead=true
// # WALK: : i32 @Int32{{*}}) isInLoop=true isLoopHead=true
// # WALK: = GetStringCodeUnit
// # WALK-NOT: CallDirect {{*}}function=f2
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
class Reader { constructor(text) { this.text = text; this.at = 0; this.sum = 0; } step() { const code = this.text.charCodeAt(this.at); this.at = this.at + 1; this.sum = (this.sum + code) | 0; return this.at < this.text.length; } run() { while (this.step()); return this.sum; } }
function total(turns) { let all = 0; for (let turn = 0; turn < turns; turn++) all = (all + new Reader("the quick brown fox").run()) | 0; return all; }
report(total(1));
report(total(50));
report("end");
