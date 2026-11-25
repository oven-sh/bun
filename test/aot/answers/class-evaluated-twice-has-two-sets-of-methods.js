// answers: without-library
// # Each evaluation of a class has closures, a class object and a prototype object of its own, and all share one layout.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
function makeClass(tag) { return class { constructor(held) { this.held = held } name() { return tag + this.held } get label() { return tag } static kind() { return "kind " + tag } } }
const First = makeClass("first ");
const Second = makeClass("second ");
function nameOf(object) { return object.name() }
report(nameOf(new First(1)));
report(nameOf(new Second(2)));
report(new First(3).label);
report(new Second(4).label);
report(First.kind());
report(Second.kind());
report(new First(5).name === new First(6).name);
report(new First(5).name === new Second(6).name);
report("end");
