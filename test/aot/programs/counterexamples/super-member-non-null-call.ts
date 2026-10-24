// `super.m!()` calls the method with the `this` of the caller.
declare const console: { log(...a: unknown[]): void };
class A { m(): unknown { return this; } }
class B extends A { n() { return super.m!(); } }
console.log(typeof new B().n());
