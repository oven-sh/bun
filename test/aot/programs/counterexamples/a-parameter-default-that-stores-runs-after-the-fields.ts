// A field initializer reads a variable before the default of a constructor's parameter stores to it.
declare const console: { log(...a: unknown[]): void };
let n = 0;
class A { x = n; constructor(a = n = 1) {} }
console.log(new A().x);
