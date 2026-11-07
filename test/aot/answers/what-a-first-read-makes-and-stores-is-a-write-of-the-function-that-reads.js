// answers: without-library
// # A closure over the scope of a literal, and what a module only stores in a variable, are made where they are first read, AND STORED. Link has counted a read. So the caller of a function that reads such a place
// # took the call to write nothing: the net stopped (testing=CheckEffectsAtRunTime: "will not write ObjectFields, and those words of operand 0 are others"), and so does the verifier of the callee's unit.
// # Each callee calls itself, so that it is called and not copied.
// # f1 = wire, f3 = start, f2 = list, f4 = both
// # RUN(CLOSURE): walk f3 mechanisms=all
// # CLOSURE: closureForm=Deferred
// # CLOSURE: CallDirect {{*}} function=f1 traits=[{{*}}mayWriteWhatIsSeen
// # RUN(VARIABLE): walk f4 mechanisms=all
// # VARIABLE: CallDirect {{*}} function=f2 traits=[{{*}}mayWriteOutsideObjects
// # RUN(NET): run-in-shell testing=CheckEffectsAtRunTime mechanisms=all globalThis.report = value => print(String(value));
// # NET: end
// # NET-NEXT: exited with 0
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
function wire(options, depth) { if (depth) return wire(options, depth - 1); const { onDone, onError } = options; return () => onDone() + (onError ? 1 : 0); }
function start(tag) { let count = tag; const step = wire({ onDone: () => ++count, onError: () => --count }, 2); return step() + count; }
const table = [10, 20, 30];
function list(depth) { return depth ? list(depth - 1) : table; }
function both(at) { return (list(2) === table ? 100 : 0) + at; }
let sum = 0;
for (let turn = 0; turn < 3; turn++) sum += start(turn) + both(turn);
report(sum);
report("end");
