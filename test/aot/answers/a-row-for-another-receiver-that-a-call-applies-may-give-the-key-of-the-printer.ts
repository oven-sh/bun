// answers: with-library
// # The call is on a class below Promise: only the last row of Promise.resolve, which constructs `this` and says nothing of what it answers, stands for it. Link tells that the row is applied:
// # it may answer the symbol under which the printer of objects looks for a method, the function stored under a key that nobody knows may be that method, and the printer is in the program.
// # The other half: a-row-that-no-call-applies-gives-the-program-no-key-of-the-printer.ts.
// # RUN(FOUND): link lookups mechanisms=all
// # FOUND: lookup reads-under-keys-nobody-knows
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
declare function report(value: unknown): void;
class Other<T> extends Promise<T> {}
const table: Record<string, () => number> = {};
const key: string = JSON.parse('"a"');
table[key] = () => 1;
report(Object.keys(table).length);
await Other.resolve(1).then(value => report(value + 1));
report("end");
