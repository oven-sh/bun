// answers: without-library
// # a store by evaluated text into a binding that is not yet initialized is a ReferenceError whatever kind the binding has: only an initialized constant answers with the TypeError
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 27 of 27 of 27
// # CHECK-NEXT: exited with 0
function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
function constant(text) { const seen = attempt(() => eval(text)); const late = 1; return seen + " | " + late; }
function variable(text) { const seen = attempt(() => eval(text)); let late = 1; return seen + " | " + late; }
function initializedConstant(text) { const late = 1; const seen = attempt(() => eval(text)); return seen + " | " + late; }
function initializedVariable(text) { let late = 1; const seen = attempt(() => eval(text)); return seen + " | " + late; }
function innerName() { let seen; class Late extends (seen = attempt(() => eval("Late = 2")), Object) {} return seen + " | " + typeof Late; }
function kept() { const store = eval("() => { late = 2; }"); const early = attempt(store); const late = 1; return early + " | " + attempt(store) + " | " + late; }
function each(text) { report(constant(text)); report(variable(text)); report(initializedConstant(text)); report(initializedVariable(text)); }
each("late = 2");
each("({ late } = { late: 2 })");
each("(() => { late = 2; })()");
each("eval('late = 2')");
each("late += 2");
each("late++");
report(innerName());
report(kept());
report("end");
