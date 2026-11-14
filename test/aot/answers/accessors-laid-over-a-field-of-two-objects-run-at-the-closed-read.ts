// answers: without-library
// # descriptors lay two getters over one field. Object.defineProperty() opens the layout, so the receiver is any object that unseen code has had, the read looks at the slot on a guess and may run any code: the variable is read again behind it
// # it guards no line of RED.txt: the answers alone are held
// # f1 = deed, f2 = witness, f3 = tell
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: key="x"{{*}}mayCallUnknownCode
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=none+TypedOperations+Folding $SHELL
// # ALSO1: 7 of 7 of 7
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
class P { x = 1; y = 2; }
function deed(p: P) { const before = log; const got = p.x; return got + " " + before + "|" + log; }
function witness(p: P) { return delete (p as any).gone; }
const plain = new P();
const first = new P();
const second = new P();
Object.defineProperty(first, "x", { get() { log = log + "a"; return 7; } });
Object.defineProperty(second, "x", { get() { log = log + "b"; return 8; } });
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => deed(plain));
tell(() => deed(first));
tell(() => deed(second));
tell(() => deed(first));
tell(() => witness(plain));
tell(() => witness(first));
report("end");
