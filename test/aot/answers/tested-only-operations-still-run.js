// answers: without-library
// # The two arms of a test do the same. What is tested is still done: a list gets shorter, a getter and a conversion run, a read of undefined throws.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
let said = "";
const holder = { get now() { said += "now,"; return 1; } };
function shortens(list) { if (list.pop()) {} return list.length; }
function asks(object) { if (object.now) {} return said; }
function reads(object) { try { if (object.inner.value) {} return "read"; } catch { return "threw"; } }
function converts(value) { if (value > 1) {} return said; }
report(shortens([1, 2, 3])); report(asks(holder)); report(reads({ inner: { value: 1 } })); report(reads({})); report(converts({ valueOf() { said += "valueOf,"; return 2; } }));
report("end");
