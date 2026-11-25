// answers: without-library
// # four fields of which Link proves that they hold booleans alone lie in a byte each. They are read, stored, negated, printed and listed as any property is.
// # f2 = make, f1 = count, f3 = flip, f4 = tell
// # RUN(FORM): plan layouts mechanisms=all
// # FORM: "a" OptionalBoolean Inline
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 38 of 38 of 38
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-TypedSlots $SHELL
// # ALSO1: 38 of 38 of 38
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
class Flags { a = false; b = false; c = false; d = false; }
function make(on: boolean) { const flags = new Flags(); flags.a = on; flags.d = !on; return flags; }
function count(flags: Flags) { return (flags.a ? 1 : 0) + (flags.b ? 2 : 0) + (flags.c ? 4 : 0) + (flags.d ? 8 : 0); }
function flip(flags: Flags) { flags.b = !flags.b; flags.c = flags.a; }
function tell(flags: Flags) { report(count(flags)); report(flags.a); report(flags.b); report(flags.c); report(flags.d); report(JSON.stringify(flags)); report(Object.keys(flags).join()); }
for (let i = 0; i < 4; i++) { const flags = make(i > 1); if (i & 1) flip(flags); tell(flags); }
const kept = make(true);
flip(kept);
flip(kept);
tell(kept);
report(typeof kept.a);
report(kept.a === true);
report("end");
