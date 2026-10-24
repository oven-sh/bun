// `new` of a checked class results in the class; `new` of a library or JavaScript class has no written result.
import { J } from "./constructors-javascript.js";
class A {
  constructor(a: number) {}
}
new A(1);
class B {}
new B();
class D extends A {}
new D(1);
class G<T> {
  constructor(v: T) {}
}
new G(1);
new Map<string, number>();
new J();
