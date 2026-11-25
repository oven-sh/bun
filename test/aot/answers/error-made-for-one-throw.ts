// answers: without-library
// # an error that is made with a written message and thrown at once has the class, the message and the identity of the error that the construction makes
// # in checked text the front end writes a cast between the construction and the throw (`Convert .. flags=[IsExpected]`): the form is shown on those records
// # f1 = type, f3 = called, f5 = caughtHere, f6 = kept, f7 = onOnePath, f8 = look
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: ThrowNewError {{*}}errorKind=TypeError
// # RUN(CALLED): walk f3 mechanisms=all
// # CALLED-LABEL: code f3:Body
// # CALLED: ThrowNewError {{*}}errorKind=SyntaxError
// # RUN(PATH): walk f7 mechanisms=all
// # PATH-LABEL: code f7:
// # PATH: ThrowNewError {{*}}errorKind=ReferenceError
// # RUN(CAUGHT): walk f5 mechanisms=all
// # CAUGHT-NOT: ThrowNewError
// # RUN(KEPT): walk f6 mechanisms=all
// # KEPT-NOT: ThrowNewError
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function type() { throw new TypeError("bad input"); }
function range() { throw new RangeError("out of range"); }
function called() { throw SyntaxError("called without new"); }
function empty() { throw new Error(""); }
function caughtHere() { try { throw new TypeError("inside"); } catch (e) { return (e as Error).message + " was caught"; } }
function kept() { const e: any = new EvalError("kept"); e.extra = 1; throw e; }
function onOnePath(flag: boolean) { if (flag) throw new ReferenceError("taken"); return "passed"; }
function look(f: (flag: boolean) => unknown, flag: boolean) { try { report(f(flag)); } catch (e: any) { report(e.name + "|" + e.message + "|" + (e instanceof TypeError) + "|" + (e instanceof Error) + "|" + (Object.getPrototypeOf(e) === e.constructor.prototype) + "|" + e.extra); } }
function twice(f: () => unknown) { let a: unknown; let b: unknown; try { f(); } catch (e) { a = e; } try { f(); } catch (e) { b = e; } report(a !== b); }
look(type, true);
look(range, true);
look(called, true);
look(empty, true);
look(caughtHere, true);
look(kept, true);
look(onOnePath, true);
look(onOnePath, false);
twice(type);
twice(kept);
look(type, false);
report("end");
