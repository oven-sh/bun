// answers: without-library
// # `function check(ok, note) { if (ok) return 1; .. }   check(a === b, note)`: the callee is too large to be copied, and most calls come back from its first branch with a constant.
// # Where the caller holds the truth of what it hands over as a raw boolean, that branch stands at the call in the place of the box, and the callee is entered on the other side alone, with the boolean that led there.
// # Where what is shown of the operand in the unit says the answer, the call is the constant, or it stays as it is. Of a value of which nothing is shown nothing is asked at the call.
// # The other operands are made in front of the branch, the boolean is what it was behind the call, and a callee that throws is caught where the call stands.
// # f1 = keep, f2 = check, f3 = demand, f4 = same, f5 = kept, f6 = twice, f7 = caught, f8 = known, f9 = unknown
// # RUN(SAME): walk f4 mechanisms=all
// # SAME-LABEL: code f4:Body
// # SAME: [[test]]: boolean @Boolean = StrictEq
// # SAME-NOT: = Box [[test]]
// # SAME: Branch [[test]] -> taken
// # SAME: = CallDirect {{*}} function=f2
// # RUN(CAUGHT): walk f7 mechanisms=all
// # CAUGHT-LABEL: code f7:Body
// # CAUGHT: [[test]]: boolean @Boolean = Less
// # CAUGHT-NEXT: Branch [[test]] -> taken
// # CAUGHT: handler=
// # CAUGHT-NEXT: = CallDirect {{*}} function=f3
// # RUN(KNOWN): walk f8 mechanisms=all
// # KNOWN-LABEL: code f8:Body
// # KNOWN-COUNT-2: = CallDirect {{*}} function=f2
// # KNOWN-NOT: = CallDirect
// # RUN(UNKNOWN): walk f9 mechanisms=all
// # UNKNOWN-LABEL: code f9:Body
// # UNKNOWN-NOT: Branch
// # UNKNOWN: = CallDirect {{*}} function=f2
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 99 of 99 of 99
// # CHECK-NEXT: exited with 0
var notes = [];
function keep(note) { notes.push(note); return note; }
function check(ok, note) { if (ok) return 1; for (var turn = 0; turn < 2; turn++) keep(note + turn); keep(note); keep(note + "!"); return 2; }
function demand(ok, note) { if (!ok) { for (var turn = 0; turn < 2; turn++) keep(note + turn); throw new RangeError(note); } }
function same(a, b) { return 10 + check(a === b, keep("second")); }
function kept(a, b) { var ok = a === b; var answer = check(ok, "kept"); return answer + " " + ok; }
function twice(a, b) { var ok = a !== b; return check(ok, ok) + " " + ok; }
function caught(a, b) { try { demand(a < b, "low"); return "passed"; } catch (error) { return error.name; } finally { keep("finally"); } }
function known() { return check(true, "never") + check(false, "always") * 10 + check(0, "zero") * 100 + check("text", "never") * 1000; }
function unknown(a) { return 10 + check(a, "unknown"); }
globalThis.fromOutside = [same, kept, twice, caught, known, unknown];
var pairs = [[1, 1], [1, 2], [2, 1], [NaN, NaN], [0, -0], ["1", 1], [undefined, null]];
function ask(a, b) { report(same(a, b)); report(kept(a, b)); report(twice(a, b)); report(caught(a, b)); report(known()); report(unknown(a)); report(notes.splice(0).join()); }
for (var round = 0; round < 2; round++) { for (var which = 0; which < pairs.length; which++) ask(pairs[which][0], pairs[which][1]); }
report("end");
