// answers: without-library
// # Behind the deletion the lookup goes on to the class above, and behind the second one it finds nothing.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
class Base { name() { return "base" } }
class Derived extends Base { name() { return "derived" } }
function nameOf(object) { return object.name() }
const derived = new Derived();
report(nameOf(derived));
delete Derived.prototype.name;
report(nameOf(derived));
delete Base.prototype.name;
let thrown = "nothing";
try { nameOf(derived) } catch (error) { thrown = error instanceof TypeError }
report(thrown);
report("end");
