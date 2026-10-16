// `instanceof` follows `Object.setPrototypeOf` on the prototype object of a class whose parent is an expression.
declare const console: { log(...a: unknown[]): void };
class A {}
class M extends (() => A)() {}
Object.setPrototypeOf(M.prototype, null);
console.log(new M() instanceof A);
