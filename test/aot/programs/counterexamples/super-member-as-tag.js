// `super.m` as the tag of a template is called with the `this` of the method.
class A { m() { return this; } }
class B extends A { tag() { return super.m`x`; } }
const b = new B();
console.log(b.tag() === b);
