// answers: without-library
// # The row of a read of a variable or of a field of an environment answers with what Link has proven of the place. The state answers the read with the value that was stored, whose own type may say less.
// # In a loop such a value is not handed on in the place of the read, so the build does not stop where it comes round.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 4 of 4 of 4
// # CHECK-NEXT: exited with 0
class Meter { get value() { return 1; } }
var held = 0;
function throughVariable(n) { const meter = new Meter(); let last = 0; for (let i = 0; i < n; i++) { held = meter.value; last = held; } return last; }
report(throughVariable(3));
function throughEnvironment(n) { const meter = new Meter(); var kept = 0, last = 0; function read() { return kept; } for (var i = 0; i < n; i++) { kept = meter.value; last = kept; } return last + read(); }
report(throughEnvironment(3));
var list;
function ofAConstruction(n) { var last = null; for (var i = 0; i < n; i++) { list = new Uint8Array([i, 1]); last = list; } return last[0]; }
report(ofAConstruction(3));
report("end");
