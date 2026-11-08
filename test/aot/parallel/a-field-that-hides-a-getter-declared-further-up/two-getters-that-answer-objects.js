// A class further up defines a field under a key for which two classes below declare getters. The read finds the field, in a family of five layouts too.
class Box { constructor(v) { this.v = v; } }
class Base { [Symbol.toStringTag] = JSON.parse("7"); }
class Loud extends Base { get [Symbol.toStringTag]() { return new Box(1); } }
class Soft extends Base { get [Symbol.toStringTag]() { return new Box(2); } }
class A extends Base {} class B extends Base {} class C extends Base {}
function read(x) { const box = x[Symbol.toStringTag]; return box.v; }
const others = [new A(), new B(), new C()];
console.log(read(new Loud()), read(new Soft()), others.length);
