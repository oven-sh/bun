// answers: with-library
// # A function is stored under a key that nobody knows. It is a method that the printer of objects calls only if that key may be the symbol under which the printer looks, so only if the program can come by that symbol.
// # The last row of Promise.resolve stands for a call on another receiver than Promise (it constructs `this`) and says nothing of what it answers: it may answer any symbol.
// # Link tells which rows the calls of the program apply. The one call here is on Promise itself: no call applies the last row, and what no call applies gives the program nothing: the printer stays out,
// # and with it all that its code reads under keys that nobody knows. The other half: a-row-for-another-receiver-that-a-call-applies-may-give-the-key-of-the-printer.ts.
// # RUN(FOUND): link lookups mechanisms=all
// # FOUND: lookup called PromiseResolve
// # FOUND-NOT: lookup reads-under-keys-nobody-knows
// # FOUND-NOT: lookup let-go
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 3 of 3 of 3
declare function report(value: unknown): void;
const table: Record<string, () => number> = {};
const key: string = JSON.parse('"a"');
table[key] = () => 1;
report(Object.keys(table).length);
await Promise.resolve(1).then(value => report(value + 1));
report("end");
