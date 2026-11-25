// answers: without-library
// # A closure in a field of a fresh object is made when somebody reads the field. It is one object however often it is read, it can be replaced, given a member and asked for its name, and two objects have two.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
function make(n) { return { run: () => n, twice() { return n * 2; }, n }; }
const one = make(1);
report(one.run === one.run); report(one.run()); report(one.twice()); report(make(2).run() + make(3).twice());
function renamed(n) { const made = make(n); const before = made.run; made.run = () => -n; return before() + ":" + made.run(); }
report(renamed(4));
function listedKeys(n) { return Object.keys(make(n)).join(); }
report(listedKeys(1));
function compared(n) { const a = make(n), b = make(n); return a.run === b.run; }
report(compared(1));
function named(n) { return make(n).run.name + ":" + make(n).twice.name + ":" + make(n).run.length; }
report(named(1));
function counter() { let n = 0; return { up: () => ++n, down: () => --n, get: () => n }; }
const shared = counter(); shared.up(); shared.up(); shared.down();
report(shared.get());
function withMember(n) { const made = make(n); made.run.tag = n; return made.run.tag; }
report(withMember(7));
report("end");
