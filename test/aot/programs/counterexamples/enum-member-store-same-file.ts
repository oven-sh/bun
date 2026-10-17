// A member of an enum of the same file, read through an optional chain, is what the object holds.
declare const console: { log(...a: unknown[]): void };
enum E { A }
const o: Record<string, unknown> = E;
o.A = 9;
console.log(E?.A, o.A);
