// answers: without-library
// # a built-in lists the keys and the values of a record between a store into a variable and the read of it; then a record of the same shape comes with a getter that stores into the variable, and a Proxy whose trap does
// # the record of ofFresh() has a shape of its own: what is done in plain sight to the records of make() (a getter laid on one, one behind a Proxy) takes the proof from their layout, and the form with it
// # the form is what the call is said to do. The read of the variable stays in this program: somebody may list the keys of Object here, so an InitializeBuiltin, which writes outside objects, stands between the store and the call
// # f1 = make, f2 = keysOf, f4 = ofFresh
// # RUN(FORM): walk f4 mechanisms=all
// # FORM-LABEL: code f4:
// # The keys of an object in sight are written out, and nothing is called: walk/AOTWalkListedOwnKeys.cpp.
// # FORM-NOT: overload=ObjectKeys
// # RUN(QUIET): walk f4 mechanisms=all
// # QUIET-NOT: mayCallUnknownCode
// # RUN(HOSTILE): walk f2 mechanisms=all
// # HOSTILE-LABEL: code f2:
// # HOSTILE: = CallInline {{*}}overload=ObjectKeys{{*}}mayCallUnknownCode
// # HOSTILE: GetModuleVariable
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let last = "start";
function make(a: unknown, b: unknown) { return { a, b }; }
function keysOf(record: object) { last = "before"; const keys = Object.keys(record); return keys.length + ":" + keys[0] + ":" + last; }
function valuesOf(record: object) { last = "before"; const values = Object.values(record); return values.length + ":" + values[1] + ":" + last; }
function ofFresh(v: unknown) { const record = { c: 1, d: v }; last = "before"; const keys = Object.keys(record); return keys.length + ":" + last; }
report(keysOf(make(1, 2)));
report(valuesOf(make(1, 2)));
report(ofFresh(3));
report(keysOf(make("x", "y")));
report(valuesOf(make("x", "y")));
const hostile = make(1, 2);
Object.defineProperty(hostile, "b", { get() { last = "getter ran"; return 9; }, enumerable: true });
report(keysOf(hostile));
report(valuesOf(hostile));
const trapped = new Proxy(make(1, 2), { ownKeys(t) { last = "trap ran"; return Reflect.ownKeys(t); } });
report(keysOf(trapped));
report(valuesOf(trapped));
report(ofFresh(4));
report("end");
