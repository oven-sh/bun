// Static fields read through the class object before they are defined.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
class C {
  static a = C.probe();
  static b = { x: 1 };
  static probe() { return C.b === undefined ? "undefined" : C.b.x; }
}
console.log(C.a, C.b.x);
class D {
  static a = attempt(() => this.b.x);
  static b = { x: 1 };
}
console.log(D.a);
class E {
  static a = attempt(() => Reflect.get(E, "b").x);
  static c = attempt(() => Object.getOwnPropertyDescriptor(E, "b").value.x);
  static d = attempt(() => Object.keys(E).join());
  static b = { x: 1 };
}
console.log(E.a, E.c, E.d);
class F { static a = attempt(() => G.b.x); }
class G extends F { static b = { x: 1 }; }
console.log(F.a);
class Base { static make() { return attempt(() => this.b.x); } }
class Sub extends Base { static a = Sub.make(); static a2 = super.make(); static b = { x: 2 }; }
console.log(Sub.a, Sub.a2);
