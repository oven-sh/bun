// answers: without-library
// # No call is written where a getter, a conversion to a primitive, a static field or a static block enters the reader.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
function attempt(f) { try { return f(); } catch (error) { return error.name; } }
const holder = { get value() { return late; }, toString() { return "s" + late; }, valueOf() { return late; } };
function name() { return Later.name; }
report(attempt(() => holder.value));
report(attempt(() => `${holder}`));
report(attempt(() => holder + 1));
class First { static early = attempt(name); static { report(attempt(name)); } }
const late = 5;
class Later { static self = attempt(() => Later.name); }
report(holder.value);
report(`${holder}`);
report(holder + 1);
report(First.early);
report(Later.self);
report(name());
report("end");
