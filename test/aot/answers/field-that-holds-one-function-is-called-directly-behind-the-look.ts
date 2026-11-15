// answers: without-library
// # every store into the field brings a closure of one function, so the slot is held to that: behind a look at the slot the call enters the function directly. An emptied slot, an accessor and another object take the closed read and the call by value
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
type Handler = (n: number) => number;
let calls = 0;
class Button { handler: Handler; label: string; constructor(label: string) { this.label = label; this.handler = n => { calls += 1; return n * 2 + this.label.length; }; } click(n: number): number { return this.handler(n); } twice(n: number): number { return this.handler(n) + this.handler(n + 1); } guarded(n: number): any { try { return this.handler(n); } catch (error) { return "threw " + (error instanceof TypeError); } } }
class Stranger { handler(n: number): number { return n + 300; } }
function press(button: Button, n: number): number { const pressed = button.handler(n); calls += 1; return pressed; }
const byName: any = { press };
report(byName);
function call(name: string, first: any, second?: any): any { return byName[name](first, second); }
function click(button: any, n: number): any { return button.click(n); }
function guarded(button: any, n: number): any { return button.guarded(n); }
const one = new Button("a");
const other = new Button("bcd");
report(click(one, 1));
report(click(other, 2));
report(one.twice(3));
report(guarded(one, 4));
report(call("press", one, 5));
report(call("press", other, 6));
report(calls);
const cleared = new Button("e");
cleared.handler = undefined as any;
report(guarded(cleared, 7));
const emptied: any = new Button("f");
delete emptied.handler;
report(guarded(emptied, 8));
Object.setPrototypeOf(emptied, { handler(n: number) { return n + 100; }, click: Button.prototype.click, guarded: Button.prototype.guarded });
report(click(emptied, 9));
report(guarded(emptied, 10));
report(call("press", emptied, 11));
report(call("press", new Stranger(), 12));
report(guarded(other, 13));
report(calls);
report("end");
declare function report(value: unknown): void;
