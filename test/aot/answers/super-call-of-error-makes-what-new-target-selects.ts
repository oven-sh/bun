// answers: without-library
// # a super call of Error stays as written: it makes the object below what new.target selects, and a message that is an object is converted by its own code, whose stores are read again behind the call
// # f1 = Other, f2 = make, f3 = describe, f4 = tell, f5 = the constructor of E
// # RUN(FORM): walk f5 mechanisms=all-Inlining
// # FORM-LABEL: code f5:Body
// # FORM: = SuperConstruct
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let made = 0;
class E extends Error { code: number; constructor(m: string) { const before = made; super(m); made = before + 1; this.code = made; } }
function Other(this: any) { }
Other.prototype = { tag: "other" };
function make(m: string) { return new E(m); }
function describe(e: any) { return String(e.message) + " " + String(e instanceof E) + " " + String(e instanceof Error) + " " + String(e.code) + " " + String(e.tag); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => describe(make("first")));
tell(() => describe(make("second")));
tell(() => describe(Reflect.construct(E, ["third"], Other)));
tell(() => describe(make(undefined as any)));
tell(() => describe(make({ toString() { made = made + 100; return "converted"; } } as any)));
tell(() => (E as any)("no new"));
tell(() => made);
report("end");
