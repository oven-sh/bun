// answers: without-library
// # The remainder by a constant with a fraction is computed in line: the quotient comes from the reciprocal and may be one too many, and the divisor is taken off in two halves without rounding.
// # Among the dividends are some below the divisor, equal to it, a multiple of it, to either side of the largest quotient that is computed in line, both zeros, the smallest numbers, the infinities and NaN.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 201 of 201 of 201
// # CHECK-NEXT: exited with 0
function tenths(x: number): number { return x % 0.1; }
function thirds(x: number): number { return x % -0.3333333333333333; }
function halves(x: number): number { return x % 0.5; }
function eighths(x: number): number { return x % 2.625; }
for (const x of [0, -0, 0.05, -0.05, 0.1, -0.1, 0.3, -0.3, 0.5, 0.7, 1, -1, 1.1, 2.5, 2.625, 5.25, -5.25, 7, -7, 7.3, -7.3, 123.456, -123.456, 1000000.1, 6710886.3, 6710886.5, -6710886.5, 22369621.3, 2147483647, -2147483648, 281474976710655.5, 281474976710656.5, 1e15, 1e21, 1e300, -1e300, 5e-324, 1e-310, Infinity, -Infinity]) { report(tenths(x)); report(thirds(x)); report(halves(x)); report(eighths(x)); report(tenths(x - x)); }
report("end");
declare function report(value: unknown): void;
