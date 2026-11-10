// answers: without-library
// # A class constructor is entered by value with new.target in front of its arguments. Whoever calls it is refused in front of the entry, by the word of its closure. The entry asks all the same, and where new.target is undefined
// # it leaves by a tail call of the call that refuses: one jump: no frame, nothing saved, nothing behind it.
// # Were the word ever to let such a call through, that jump would come round to this entry for ever. Under the word that checks proofs at run time the refusal is a call with a stop behind it: the stack runs out, or the stop is met.
// # f1 = tell, f2 = Plain, f3 = Other
// # RUN(REFUSAL): bytes f2:GenericCallEntry f3:GenericCallEntry mechanisms=all
// # REFUSAL-LABEL: unit f2:GenericCallEntry
// # REFUSAL-NOT: Call Stub CallValueCell
// # REFUSAL: Jump Stub CallValueCell.InTailPosition
// # REFUSAL-LABEL: unit f3:GenericCallEntry
// # REFUSAL-NOT: Call Stub CallValueCell
// # REFUSAL: Jump Stub CallValueCell.InTailPosition
// # RUN(CHECKED): bytes f2:GenericCallEntry mechanisms=all testing=CheckProofsAtRunTime
// # CHECKED-LABEL: unit f2:GenericCallEntry
// # CHECKED-NOT: Jump Stub CallValueCell
// # CHECKED: Call Stub CallValueCell.Ordinary
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
class Plain { first: unknown; constructor(first: unknown) { this.first = first; } }
class Other { first: unknown; constructor(first: unknown) { this.first = [first]; } }
const classes: any[] = [Plain, Other];
function tell(made: any) { report(typeof new made(1).first); try { made(1); report("no error"); } catch (error) { report((error as Error).constructor === TypeError); } }
for (let turn = 0; turn < 3; turn++) { tell(classes[0]); tell(classes[1]); }
report("end");
