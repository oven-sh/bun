// A function read out of a literal that is seen as an interface declared under `declare global` is a new one for each literal.
declare const console: { log(...a: unknown[]): void };
declare global { interface Amb { m(): void } }
export const make = () => ({ m: () => {} }), a: Amb = make(), b: Amb = make();
console.log(a.m === b.m);
