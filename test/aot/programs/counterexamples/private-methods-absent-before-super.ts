// `#m in this` is false while the constructor of the parent class runs.
declare const console: { log(...a: unknown[]): void };
class Base { constructor() { console.log(D.has(this)); } }
class D extends Base { #m() {} static has(o: object) { return #m in o; } }
new D();
