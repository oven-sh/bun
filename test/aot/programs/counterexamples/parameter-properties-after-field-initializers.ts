// A TypeScript parameter property is stored after the field initializers have run.
declare const console: { log(...a: unknown[]): void };
class A { x = (this as any).p; constructor(public p: number) {} }
console.log(new A(5).x);
