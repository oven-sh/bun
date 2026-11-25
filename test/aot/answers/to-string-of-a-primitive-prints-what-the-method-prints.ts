// answers: without-library
// # toString() of a number, a boolean or a BigInt prints as the conversion prints. A radix that is not proven to be ten goes to the method, which throws for one
// # f1 = decimal, f2 = ten, f3 = unset, f4 = radix, f5 = flag, f6 = big, f7 = joined, f8 = either, f9 = tell
// # numbers alone arrive at `decimal`, so its receiver is proven by what its callers hand it. The text arrives at `either`, a function of its own: in plain sight at `decimal` it would widen the parameter, and the form would be gone
// # RUN(FORM): walk f1 mechanisms=all-Inlining-ParameterGuards
// # FORM-LABEL: code f1:Body
// # FORM: = ToString
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function decimal(n: unknown) { return typeof n === "number" ? n.toString() : "none"; }
function ten(n: unknown) { return typeof n === "number" ? n.toString(10) : "none"; }
function unset(n: unknown) { return typeof n === "number" ? n.toString(undefined) : "none"; }
function radix(n: unknown, r: any) { return typeof n === "number" ? n.toString(r) : "none"; }
function flag(b: unknown) { return typeof b === "boolean" ? b.toString() : "none"; }
function big(i: unknown) { return typeof i === "bigint" ? i.toString() + i.toString(10) : "none"; }
function joined(n: unknown) { return typeof n === "number" ? "<" + n.toString() + ">" : "none"; }
function either(n: unknown) { return typeof n === "number" ? n.toString() : "none"; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
tell(() => decimal(5));
tell(() => decimal(-0));
tell(() => decimal(NaN));
tell(() => decimal(1e21));
tell(() => decimal(0.1 + 0.2));
tell(() => decimal(-Infinity));
tell(() => ten(255));
tell(() => unset(255));
tell(() => radix(255, 16));
tell(() => radix(255, 10));
tell(() => radix(255, 1));
tell(() => radix(255, { valueOf() { return 2; } }));
tell(() => flag(true));
tell(() => flag(false));
tell(() => big(12345678901234567890n));
tell(() => joined(1.5));
tell(() => either("5"));
tell(() => either(5));
report("end");
