// answers: without-library
// # a throw under a catch that reads nothing of what it catches is a jump, and what only feeds the throw is not built. A call of the engine's that goes by one row and changes what is read later is built all the same: the entry lies in the map behind the catch
// # the map and the set are written as any: behind a call whose answer has a written type the front end lays a Convert, which ends the search for what feeds the throw before it comes to the call
// # f1 = stores, f2 = adds, f3 = keeps, f4 = each
// # RUN(KEPT): walk f1 f2 mechanisms=all
// # KEPT-LABEL: code f1:Body
// # KEPT: overload=MapPrototypeSet
// # KEPT-LABEL: code f2:Body
// # KEPT: overload=SetPrototypeAdd
// # RUN(JUMP): walk f1 f2 f3 mechanisms=all
// # JUMP-NOT: Throw v
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const kept: any = new Map();
function stores(bad: unknown) { const seen: any = new Map(); try { if (bad) throw seen.set("thrown", 1); } catch { return "caught " + seen.size; } return "fine " + seen.size; }
function adds(bad: unknown) { const seen: any = new Set(); try { if (bad) throw seen.add("thrown"); } catch { return "caught " + seen.size; } return "fine " + seen.size; }
function keeps(bad: unknown) { try { if (bad) throw kept.set(kept.size, 1); } catch { return "caught " + kept.size; } return "fine " + kept.size; }
function each(f: (bad: unknown) => unknown) { report(f(false)); report(f(true)); report(f(0)); report(f("x")); }
each(stores);
each(adds);
each(keeps);
report("end");
