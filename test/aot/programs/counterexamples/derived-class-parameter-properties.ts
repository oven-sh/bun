// In a derived class the field initializers run behind `super()` and before a TypeScript parameter property is stored.
declare const console: { log(...a: unknown[]): void };
class P {}
class B extends P { y = (this as any).q; constructor(public q: number) { super(); } }
console.log(new B(5).y);
