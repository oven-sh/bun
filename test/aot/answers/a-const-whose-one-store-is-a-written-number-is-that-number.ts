// answers: without-library
// # A const of a module keeps its dead zone: every function that reads it asks whether it is filled. Behind that check nothing is left to ask where the one store in the whole program
// # lays a written number or boolean there: the value is that literal, so an index is a written index, a factor a written factor, and a flag chooses its arm at the build.
// # The read in front of the store still throws: the first answer is "dead zone".
// # f1 = pick, f2 = scale, f3 = flag
// # RUN(PICK): walk f1 mechanisms=all
// # PICK: = Integer integer=2
// # PICK: = CheckInitialized {{*}}name="AT"
// # RUN(SCALE): walk f2 mechanisms=all
// # SCALE: = Double number=0.5
// # SCALE: = CheckInitialized {{*}}name="HALF"
// # RUN(FLAG): walk f3 mechanisms=all
// # FLAG: = CheckInitialized {{*}}name="ON"
// # FLAG-NOT: Branch
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
function pick(list: number[]): number { return list[AT]; }
function scale(x: number): number { return x * HALF; }
function flag(): string { return ON ? "on" : "off"; }
function early(): string { try { return String(pick([1, 2, 3, 4])); } catch (e) { return "dead zone"; } }
report(early());
const AT = 2;
const HALF = 0.5;
const ON = true;
report(early());
for (let round = 0; round < 2; round++) { report(pick([5, 6, 7 + round])); report(scale(3 + round)); report(flag()); }
report("end");
