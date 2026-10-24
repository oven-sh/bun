// instanceof follows the prototype objects, not the parents of the class objects; both can be changed apart.
class A { a() { return "a"; } static s() { return "As"; } }
class B { b() { return "b"; } }
class C extends A {}
const b = new B(), c = new C();
console.log(b instanceof A, c instanceof A, typeof B.s);
Object.setPrototypeOf(B, A);
console.log(b instanceof A, new B() instanceof A, B.s(), typeof new B().a);
Object.setPrototypeOf(C, B);
console.log(c instanceof A, new C() instanceof A, new C() instanceof B, typeof C.s, new C().a());
Object.setPrototypeOf(C.prototype, B.prototype);
console.log(c instanceof A, c instanceof B, new C() instanceof A, typeof c.a, c.b());
class D extends A {}
Object.setPrototypeOf(D.prototype, null);
console.log(Object.create(D.prototype) instanceof A, Object.create(D.prototype) instanceof D);
function F() {} const f = new F(); F.prototype = {}; console.log(f instanceof F, new F() instanceof F);
class G {} const g = new G(); Object.setPrototypeOf(g, A.prototype); console.log(g instanceof G, g instanceof A, g.a());
class H extends A {} const isA = x => x instanceof A; console.log([new H(), new B(), {}, null, 5, Object.create(A.prototype), Object.create(null)].map(isA).join());
