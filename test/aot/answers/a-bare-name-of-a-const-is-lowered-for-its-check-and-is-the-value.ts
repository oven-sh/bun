// answers: without-library
// # A const whose initializer is a written value and stands above its reader: the front end knows the value (ConstantOutsideDeadZone) and used it inside operators, templates, keys and calls.
// # A bare name was left out. Now it is lowered for its check, which still throws in the dead zone (the first answer), and what goes on is the written value: the records hold the constant,
// # so the scan, Link, the looks at loops and the walk all see it, and an arm that a flag rules out is not built.
// # f1 = six, f2 = name, f3 = open
// # RUN(SIX): walk f1 mechanisms=none
// # SIX: = Integer integer=6
// # SIX: = CheckInitialized {{*}}name="SIX"
// # RUN(NAME): walk f2 mechanisms=none
// # NAME: = String string="name"
// # NAME: = CheckInitialized {{*}}name="NAME"
// # RUN(OPEN): walk f3 mechanisms=all
// # OPEN: = CheckInitialized {{*}}name="OPEN"
// # OPEN-NOT: Branch
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
report(early());
const SIX = 6;
const NAME = "name";
const OPEN = true;
function six(): number { return SIX; }
function name(): string { return NAME; }
function open(): string { return OPEN ? "open" : "shut"; }
function early(): string { try { return String(six()); } catch (e) { return "dead zone"; } }
report(early());
for (let round = 0; round < 2; round++) { report(six()); report(name()); report(open()); }
report("end");
declare function report(value: unknown): void;
