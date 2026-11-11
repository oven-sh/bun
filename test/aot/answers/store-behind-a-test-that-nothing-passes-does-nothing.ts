// answers: without-library
// # no caller hands mark() a function, so nothing passes the test in front of its store and no run comes to it: the caller's own object is as it was
// # the form that is owed stands in ../link/store-behind-a-test-that-nothing-passes-does-nothing-from-source.ir
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 2 of 2 of 2
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function mark(o: unknown) { if (typeof o === "function") (o as any).seen = 1; }
function twice(box: { n: number }) { const before = box.n; mark(1); mark("text"); return before * 10 + box.n; }
report(twice({ n: 4 }));
report("end");
