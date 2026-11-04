export class A { f: () => number = () => 1; }
export class B extends A { }
Object.defineProperty(B.prototype, "g", { get() { return () => 9; } });
export class C { get f() { return () => 4; } }
