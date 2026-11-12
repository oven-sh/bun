// answers: without-library
// # Stores by name on a receiver of which nothing is known, under a try: where the cell has no room left the stub lays new storage into the object, and where there is no memory for that it neither collects nor throws.
// # One poll behind the last store of the run throws for them, under the handler. Outside every handler the error waits for the next poll.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
// # RUN(UNDER): walk f2 mechanisms=all
// # UNDER: PropSet {{*}} key="a"
// # UNDER-NOT: LoopHint
// # UNDER: PropSet {{*}} key="c"
// # UNDER-NEXT: LoopHint [throwsOwedError]
// # RUN(OUTSIDE): walk f3 mechanisms=all
// # OUTSIDE-NOT: LoopHint
const box = JSON.parse('{"held":null}');
function unknown(value) { box.held = value; return box.held; }
function storeThree(o, i) { try { o.a = i; o.b = i; o.c = i; } catch (error) { return "caught"; } return "stored"; }
function storeOutside(o, i) { o.a = i; o.b = i; return "stored"; }
const first = unknown({});
report(storeThree(first, 1));
report(first.a + first.b + first.c);
report(storeThree(unknown(Object.freeze({})), 2));
report(storeThree(unknown(null), 3));
report(storeThree(unknown({ set b(value) { throw new Error("no"); } }), 4));
report(storeOutside(unknown({}), 5));
report("end");
