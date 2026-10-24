// `[f = one] = [two]` stores two: calls of f run it.
declare const console: { log(...a: unknown[]): void };
const one = () => 1;
let f = one;
[f = one] = [() => 2];
console.log((() => f())());
