// answers: without-library
// # Reflect.construct(Base, [], Derived) makes an object below Derived.prototype that never went through the initializer of Derived.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 29 of 29 of 29
// # CHECK-NEXT: exited with 0
class Base { b = 1; }
class Derived extends Base { #x = 7; get() { return this.#x; } set(v: number) { this.#x = v; } has() { return #x in this; } }
function attempt(f: () => unknown) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
const whole = new Derived();
const half: any = Reflect.construct(Base, [], Derived);
for (let round = 0; round < 3; round++) { attempt(() => whole.get()); attempt(() => whole.has()); attempt(() => whole.set(round)); attempt(() => half instanceof Derived); attempt(() => half.b); attempt(() => half.has()); attempt(() => half.get()); attempt(() => half.set(1)); attempt(() => half.has()); }
const both: Derived[] = [whole, half];
let text = "";
for (let i = 0; i < 40; i++) { try { text += both[i & 1].get(); } catch { text += "x"; } }
report(text);
report("end");
