// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS2364 3
// DIAGNOSTIC: TS2701 1

// Each statement stores to what is no target of an assignment, an early error of the language, so the build stops. Plain Bun prints another output.
var a, b;
[(a = 1)] = [];
for ([(a = 1)] of []);
({ a: (b = 1) } = {});
({ ...a = 1 } = {});
