// answers: without-library
// # Static fields and a static block construct instances of the class that is being evaluated.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
class Registry { static first = new Registry("first"); static names = [Registry.first.name()]; constructor(tag) { this.tag = tag } name() { return "registry " + this.tag } static { Registry.second = new Registry("second") } }
report(Registry.first.name());
report(Registry.second.name());
report(Registry.names[0]);
report(Registry.first instanceof Registry);
report(Object.getPrototypeOf(Registry.second) === Registry.prototype);
report("end");
