// answers: without-library
// # a switch lists no case that the proven type of its subject rules out: what is 1 is no 2, and what is 7 is neither 1 nor 2, so that switch is a jump. Every value still finds the case that strict equality finds
// # from source the type is proven where the front end reads the proof: on the edge of a case it binds the variable anew, so the switch inside asks what the case has narrowed
// # behind `typeof v === "string"` it reads v itself, of which the walk by itself knows nothing more: text and count keep their switches until a test gives the tested value a narrower name, which is a row of unions-and-narrowing
// # f1 = text, f2 = count, f3 = inner, f4 = mixed, f5 = outside, f6 = each
// # RUN(FORM): walk f3 mechanisms=none+TypedOperations+Folding
// # FORM-LABEL: code f3:Body
// # FORM: Switch {{*}} cases=[1, 2] -> case
// # FORM-NOT: cases=[1, 2]
// # RUN(GONE): walk f3 mechanisms=none+TypedOperations+Folding
// # GONE-NOT: string="two"
// # RUN(JUMP): walk f5 mechanisms=none+TypedOperations+Folding
// # JUMP-LABEL: code f5:Body
// # JUMP: Switch {{*}} cases=[7, 2] -> case
// # JUMP-NOT: Switch
// # RUN(JUMPGONE): walk f5 mechanisms=none+TypedOperations+Folding
// # JUMPGONE-NOT: string="inner one"
// # JUMPGONE-NOT: string="inner two"
// # RUN(WRITTEN): walk f3 f5 mechanisms=none
// # WRITTEN-LABEL: code f3:Body
// # WRITTEN: string="two"
// # WRITTEN-COUNT-2: cases=[1, 2]
// # WRITTEN-LABEL: code f5:Body
// # WRITTEN: string="inner one"
// # WRITTEN: cases=[7, 2]
// # WRITTEN: cases=[1, 2]
// # RUN(KEPT): walk f4 mechanisms=none+TypedOperations+Folding
// # KEPT-LABEL: code f4:Body
// # KEPT: Switch
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 76 of 76 of 76
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function text(v: any) { if (typeof v === "string") { switch (v) { case 1: return "one"; case 2: return "two"; default: return "rest" + v; } } return "no text"; }
function count(v: any) { if (typeof v === "number") { switch (v) { case "1": return "text one"; case "2": return "text two"; default: return "rest" + v; } } return "no number"; }
function inner(v: any) { switch (v) { case 1: switch (v) { case 1: return "one"; case 2: return "two"; default: return "rest"; } case 2: return "outer two"; } return "outer rest"; }
function mixed(v: any) { if (typeof v === "number") { switch (v) { case 0: return "zero"; case 1: return "one"; case 7: return "seven"; default: return "rest"; } } return "no number"; }
function outside(v: any) { switch (v) { case 7: switch (v) { case 1: return "inner one"; case 2: return "inner two"; default: return "inner rest"; } case 2: return "outer two"; } return "outer rest"; }
function each(f: (v: any) => unknown) { report(f(1)); report(f(2)); report(f("1")); report(f("2")); report(f(0)); report(f(-0)); report(f(NaN)); report(f(1.5)); report(f(7)); report(f(2 ** 40)); report(f(true)); report(f(null)); report(f(undefined)); report(f({ valueOf() { return 1; } })); report(f(1n)); }
each(text);
each(count);
each(inner);
each(mixed);
each(outside);
report("end");
