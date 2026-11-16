// answers: without-library
// # As closure-escapes-to-a-getter-that-is-laid-above-it-late.ir, with an object in the place of the number: the getter calls the closure that it gets as `this` with an object of another layout than the one caller in sight passes.
// # Once f kept `callers-known` and its parameter the layout of `{ x }`: the read of `x` took the first slot of `{ pad, x }`, and the program said something else than `right` without a word.
// # f1 = f
// # RUN(LINK): link functions mechanisms=all
// # LINK-NOT: function f1 callers-known
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let armed = false;
let seen: any = "getter never ran";
const f = (o: any) => o.x;
const run = (step: any) => step();
const patch = () => { const original = Function.prototype.toString; Object.defineProperty(Function.prototype, "toString", { configurable: true, get() { if (armed) { armed = false; seen = (this as any)({ pad: "wrong", x: "right" }); } return original; } }); };
const early = f.toString;
report(typeof early + " " + f({ x: "one" }));
run(patch);
armed = true;
const late = f.toString;
report(typeof late + " " + seen);
report("end");
