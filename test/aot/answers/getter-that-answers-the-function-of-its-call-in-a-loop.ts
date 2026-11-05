// answers: without-library
// # `formatter.format(value)`: the name finds a getter, which answers the function that is called. The read stands in the source as the read of a method for its call, which no guess counts: a guess that counted the getter all the same was opened over an empty stretch, the read was never built, and the walk stopped at the call.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
const formatter = new Intl.NumberFormat("en");
const values = [1, 2.5, 1000];
for (let i = 0; i < values.length; i++) report(formatter.format(values[i]));
function formatted(with_: Intl.NumberFormat, value: number) { let text = ""; for (let i = 0; i < 2; i++) text += with_.format(value + i) + ";"; return text; }
report(formatted(formatter, 7));
report(formatted(new Intl.NumberFormat("en"), 1234));
report("end");
