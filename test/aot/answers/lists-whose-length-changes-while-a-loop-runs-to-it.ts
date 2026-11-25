// answers: without-library
// # a loop runs to `list.length` while the turns push, pop, cut the list, write it through another name, or change what else the loop reads; and what is no list answers for `length` by a getter and by valueOf, each as often as the language says
// # f1 = below
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = GetArrayLength
// # what a look says of a length holds in the walk: under Validate a walk that brings round more than the look has said stops the build
// # OPTIONS: check=Validate
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-LoopInvariants $SHELL
// # ALSO1: 17 of 17 of 17
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-Guesses $SHELL
// # ALSO2: 17 of 17 of 17
// # ALSO2-NEXT: exited with 0
declare function report(value: unknown): void;
class Limits { most: number; constructor(most: number) { this.most = most; } }
function below(list: string[], limits: Limits) { let count = 0; for (let i = 0; i < list.length; i++) { if (i < limits.most) count++; } return count; }
function grows(list: string[], limits: Limits) { let count = 0; for (let i = 0; i < list.length; i++) { if (i < limits.most) { count++; list.push("more"); } } return count; }
function shrinks(list: string[], limits: Limits) { let count = 0; for (let i = 0; i < list.length; i++) { if (i < limits.most) count++; list.pop(); } return count; }
function cuts(list: string[], limits: Limits) { let count = 0; for (let i = 0; i < list.length; i++) { if (i < limits.most) count++; if (i === 1) list.length = 2; } return count; }
function moves(list: string[], limits: Limits) { let count = 0; for (let i = 0; i < list.length; i++) { if (i < limits.most) count++; limits.most--; } return count; }
function throughAnotherName(list: string[], same: string[], limits: Limits) { let count = 0; for (let i = 0; i < list.length; i++) { if (i < limits.most) count++; if (i === 0) same.push("x", "y"); } return count; }
function stranger(list: any, limits: Limits) { let count = 0; for (let i = 0; i < list.length; i++) { if (i < limits.most) count++; } return count; }
function adds(list: any) { let sum: any = 0; for (let i = 0; i < 3; i++) sum += list.length; return sum; }
(globalThis as any).kept = [below, grows, shrinks, cuts, moves, throughAnotherName, stranger, adds];
report(below(["a", "b", "c"], new Limits(2)));
report(below([], new Limits(2)));
report(grows(["a", "b", "c"], new Limits(5)));
report(shrinks(["a", "b", "c", "d", "e"], new Limits(9)));
report(cuts(["a", "b", "c", "d", "e"], new Limits(9)));
report(moves(["a", "b", "c", "d", "e"], new Limits(3)));
const shared = ["a", "b"];
report(throughAnotherName(shared, shared, new Limits(9)));
let asked = 0;
report(stranger({ get length() { asked++; return 3; } }, new Limits(2)));
report(asked);
report(stranger({ length: { valueOf() { asked += 10; return 2; } } }, new Limits(9)));
report(asked);
report(stranger("text", new Limits(3)));
report(adds(["a", "b"]));
report(adds({ length: "7" }));
report(adds({ length: 0.5 }));
report(adds("text"));
report("end");
