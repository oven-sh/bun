// answers: with-library
// # A read of a static name that neither the class nor its bases list, that nothing has laid on the class object, and that Function.prototype and what lies above it do not have, gives undefined, as it does off a plain function:
// # the variable that takes the answer is proven to hold a text or undefined. The second class gets the name by a store: its read gives what was stored beside undefined.
// # RUN(LINK): link variables mechanisms=all
// # LINK: variable g0 proven=undefined|string|absent writers-known
// # LINK: variable g1 proven=undefined|int{{*}}|string|absent writers-known
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
let first = "none";
let second = "none";
class Reader { constructor(text) { this.text = text; } }
class Writer { constructor(text) { this.text = text; } }
function tell() { return typeof first + " " + typeof second + " " + String(second); }
report(tell());
first = Reader.extra;
second = Writer.other;
report(tell());
Writer.other = 7;
second = Writer.other;
report(tell());
report(new Reader("a").text + new Writer("b").text);
report("end");
