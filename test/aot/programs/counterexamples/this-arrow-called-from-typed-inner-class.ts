// An arrow function that reads a field of `this` is called from a method of a class declared inside the method.
declare const console: { log(...a: unknown[]): void };
class Outer { v = 1; m() { const f = () => this.v; class Inner { k() { return f(); } } return new Inner().k(); } }
console.log(new Outer().m());
