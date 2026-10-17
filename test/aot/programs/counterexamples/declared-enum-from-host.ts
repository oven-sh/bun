// A member of a `declare enum` is read from the global object that provides it.
declare const console: { log(...a: unknown[]): void };
declare enum D { A = 1 }
(globalThis as any).D = { A: 2 };
console.log(D.A);
