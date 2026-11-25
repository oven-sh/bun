// answers: without-library
// # `{ 0: 5, get 1() { .. } }`: the definition of an accessor under an index lays the elements of the object in another storage. The rows of DefineGetter, DefineSetter, DefineAccessors and of the two operations of the run time
// # named no write of ArrayStorage and Elements; the net under effects stopped: "will not write ArrayStorage, Elements, and those words of operand 0 are others behind it".
// # RUN(NET): run-in-shell testing=CheckEffectsAtRunTime mechanisms=all globalThis.report = value => print(String(value));
// # NET: 999
// # NET-NEXT: end
// # NET-NEXT: exited with 0
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
function one() { const o = { 0: 5, get 1() { return 7; }, 2: 9 }; return o[0] + o[1] + o[2]; }
function both() { const o = { 0: 1, 1: 2, get 2() { return this[0] + this[1]; }, set 2(v) { this[0] = v; } }; const a = o[2]; o[2] = 10; return a * 100 + o[2]; }
let sum = 0;
for (let turn = 0; turn < 3; turn++) sum += one() + both();
report(sum);
report("end");
