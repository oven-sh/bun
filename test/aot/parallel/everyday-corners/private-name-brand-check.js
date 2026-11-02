// Private name brand check: compiled answers as plain.
class A {
  #p = 1;
  static has(o) {
    return #p in o;
  }
  static read(o) {
    try {
      return o.#p;
    } catch (e) {
      return e.constructor.name;
    }
  }
}
class B extends A {}
console.log(A.has(new A()), A.has(new B()), A.has({}), A.read({}), A.read(new B()), A.read(Object.create(new A())));
