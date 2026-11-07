// answers: without-library
// # An accessor on a proven layout is called directly only while nobody defines the property anew, on the prototype object or on the instance.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
class Box { constructor(held) { this.held = held } get value() { return this.held } set value(next) { this.held = next } }
function valueOf(box) { return box.value }
function fill(box, next) { box.value = next }
const box = new Box(1);
report(valueOf(box));
fill(box, 2);
report(valueOf(box));
Object.defineProperty(Box.prototype, "value", { get() { return this.held * 100 }, set(next) { this.held = next + 1 }, configurable: true });
report(valueOf(box));
fill(box, 3);
report(valueOf(box));
report(box.held);
Object.defineProperty(box, "value", { value: "own", writable: true, configurable: true });
report(valueOf(box));
fill(box, "stored");
report(valueOf(box));
report(box.held);
report("end");
