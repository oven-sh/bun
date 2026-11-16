// answers: with-library
// # a RegExp is made of a number, of null, undefined, true, of nothing, of the empty text, with and without new: source, flags, a match, and that each call makes its own
// # the library rides along: `flags` is a getter that is written in JavaScript
// # f1 = status, f2 = ofNull, f3 = ofUndefined, f7 = called, f10 = refused, f11 = tell
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = NewRegExp pattern=made "404"
// # RUN(NULL): walk f2 mechanisms=all
// # NULL-LABEL: code f2:Body
// # NULL: = NewRegExp pattern="null"
// # RUN(UNDEFINED): walk f3 mechanisms=all
// # UNDEFINED-LABEL: code f3:Body
// # UNDEFINED: = NewRegExp
// # RUN(CALLED): walk f7 mechanisms=all
// # CALLED-LABEL: code f7:Body
// # CALLED: = NewRegExp pattern=made "1.5"
// # flags that are no text are left to the function, which throws
// # RUN(REFUSED): walk f10 mechanisms=all
// # REFUSED-NOT: = NewRegExp
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function status() { return new RegExp(404 as any); }
function ofNull() { return new RegExp(null as any); }
function ofUndefined() { return new RegExp(undefined as any); }
function ofTrue() { return new RegExp(true as any); }
function ofNothing() { return new (RegExp as any)(); }
function ofEmpty() { return new RegExp(""); }
function called() { return RegExp(1.5 as any); }
function minusZero() { return new RegExp(-0 as any); }
function withFlags() { return new RegExp(undefined as any, "g"); }
function refused() { return new RegExp(404 as any, 5 as any); }
function tell(f: () => RegExp) { try { const re = f(); report(re.source + "/" + re.flags + " " + re.test("404 null undefined true 1x5 0") + " " + re.lastIndex + " " + (f() === re)); } catch (e) { report((e as Error).name); } }
tell(status);
tell(ofNull);
tell(ofUndefined);
tell(ofTrue);
tell(ofNothing);
tell(ofEmpty);
tell(called);
tell(minusZero);
tell(withFlags);
tell(refused);
tell(status);
report("end");
