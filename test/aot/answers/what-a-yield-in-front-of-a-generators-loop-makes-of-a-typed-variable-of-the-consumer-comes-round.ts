// answers: with-library
// # A generator yields a text in front of its loop; the consumer's turn at that yield stores a number into a variable born undefined. The compiled program once answered `undefined undefined`: the generator's head was typed by what the consumer's loop was assumed to hold.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const n = (value: number): number => JSON.parse("" + value);
function* parts(count: number): Generator<string | number> { yield "head"; for (let i = 0; i < count; i++) yield i; }
function run(count: number): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let found: number | undefined; for (const part of parts(count)) { if (typeof part === "string") found = part.length; } return typeof found + " " + found + " " + work; }
report(run(n(3)));
report(run(n(2)));
report("end");
