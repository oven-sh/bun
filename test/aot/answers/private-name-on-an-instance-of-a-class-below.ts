// answers: without-library
// # An instance of a class below has the name of the class above in the same slot, and a name of the same spelling of its own beside it.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 26 of 26 of 26
// # CHECK-NEXT: exited with 0
class Base { #x = 1; #y: number; constructor(y: number) { this.#y = y; } sum() { return this.#x + this.#y; } bump() { this.#x++; return this; } static has(o: any) { return #x in o; } static x(o: Base) { return o.#x; } static sumOf(o: any) { return o.#x + o.#y; } }
class Mid extends Base { #x = 10; z = 3; constructor(y: number) { super(y); } own() { return this.#x; } static has(o: any) { return #x in o; } static ownOf(o: any) { return o.#x; } }
class Low extends Mid { #w = "w"; w() { return this.#w; } static wOf(o: any) { return o.#w; } }
function attempt(f: () => unknown) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
const list: Base[] = [new Base(2), new Mid(3), new Low(4)];
let total = 0;
for (let round = 0; round < 4; round++) { for (let i = 0; i < 3; i++) { const o = list[i]; total += o.bump().sum() + Base.x(o); } }
report(total);
for (let i = 0; i < 3; i++) { const o: any = list[i]; report(Base.has(o)); report(Mid.has(o)); attempt(() => Mid.ownOf(o)); attempt(() => Low.wOf(o)); attempt(() => Base.sumOf(o)); attempt(() => o.sum()); attempt(() => o.own()); attempt(() => o.w()); }
report("end");
