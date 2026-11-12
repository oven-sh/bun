// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here the field holds a text or null; the calls are written out.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 13 of 13 of 13
// # CHECK-NEXT: exited with 0
class Entry { constructor(name, size, note) { this.name = name; this.size = size; this.note = note; } }
function pick(a, b, key, exact) { if (!a.size || !b.size || a.note === null || b.note === null) return "none"; const flag = exact ? key === a.size : key < b.size; const side = flag ? a : b; const size = flag ? a.size : b.size; if (size && side.note !== null) return side.note; return "leaf"; }
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, "second"), 1, false));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, "second"), 1, true));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, "second"), 3, false));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, "second"), 3, true));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, "second"), 9, false));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, "second"), 9, true));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, null), 1, false));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, null), 1, true));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, null), 3, false));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, null), 3, true));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, null), 9, false));
report(pick(new Entry("a", 1, "first"), new Entry("b", 5, null), 9, true));
report("end");
