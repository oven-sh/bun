// answers: without-library
// # `x === x` and `x !== x` ask one thing of one value: whether it is the double NaN. An int32, a cell, undefined, null and a boolean equal themselves, and strict equality runs no code.
// # So the comparison of a value with itself is written in line whatever is known of the value: the tag of an int32, the tag of a number, the number against itself. No stub is called.
// # That is a state of knowledge with a name of its own in the schema, ValueAndItself, which the row of StrictEq lists under openUnder.
// # OPTIONS: report=Flow
// # RUN(ROWS): bytes-by-form mechanisms=all
// # ROWS-NOT: not named:
// # ROWS-NOT: StrictEq Generic
// # ROWS: StrictEq ValueAndItself Anywhere Open
// # ROWS-NOT: StrictEq Generic
// # RUN(NAMED): named-forms StrictEq
// # NAMED: StrictEq Generic Closed, in a loop Open by the loop
// # NAMED: StrictEq ValueAndItself Open, in a loop Open by the loop
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 73 of 73 of 73
// # CHECK-NEXT: exited with 0
function same(x: unknown): boolean { return x === x; }
function pick(x: unknown): string { return x !== x ? "not itself" : "itself"; }
const zero = [0][0];
const values: unknown[] = [0, -0, 1, -2147483648, 0.5, Infinity, NaN, zero / zero, Infinity - Infinity, "", "text", true, null, undefined, 10n, Symbol.iterator, {}, [NaN]];
for (let round = 0; round < 2; round++) for (let at = 0; at < values.length; at++) { report(same(values[at])); report(pick(values[at])); }
report("end");
