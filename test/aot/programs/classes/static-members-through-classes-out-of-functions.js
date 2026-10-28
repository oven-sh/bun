// Static fields, accessors, methods and private static names of the class out of the function are read and written through the classes below.
const lines = [];
class Base { static shared = "base"; static who() { return "who:" + this.name; } }
const Kinded = (Parent, kind) => class extends Parent { static kind = kind; static #count = 0; static next() { return ++Kinded.last.count; } static bump() { return ++this.tally; } static tally = 0; static get upper() { return this.kind.toUpperCase(); } static own() { return Object.hasOwn(this, "kind"); } };
Kinded.last = { count: 0 };
class A extends Kinded(Base, "a") {}
class B extends Kinded(Base, "b") { static kind = "b-own"; }
class C extends Kinded(Kinded(Base, "inner"), "outer") {}
lines.push(A.kind, B.kind, C.kind, A.upper, B.upper, C.upper, A.shared, C.shared, A.who(), C.who(), A.own(), B.own(), C.own());
lines.push(A.bump(), A.bump(), Object.hasOwn(A, "tally"), Object.getPrototypeOf(A).tally, B.bump(), C.bump(), Object.getPrototypeOf(C).tally);
A.kind = "changed"; lines.push(A.kind, Object.getPrototypeOf(A).kind, A.own());
Object.getPrototypeOf(C).kind = "patched"; lines.push(C.kind, C.upper);
delete Object.getPrototypeOf(C).kind; lines.push(C.kind, C.upper);
Base.shared = "moved"; lines.push(A.shared, B.shared, C.shared);
let length = 0; for (let i = 0; i < 400; i++) length += A.kind.length + B.kind.length + C.kind.length + C.shared.length; lines.push(length);
console.log(lines.join(" "));
