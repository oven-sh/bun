// `Reflect.construct(A, [], Object)` makes no instance of A.
declare const console: { log(...a: unknown[]): void };
class A {}
class M extends (A as new () => A) {}
console.log(Reflect.construct(A, [], Object) instanceof A);
