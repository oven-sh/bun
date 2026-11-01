export class A { f: unknown = () => 1; }
export class B extends A { f: unknown = 5; }
export class C extends A { f: unknown = () => 3; }
