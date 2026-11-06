// Super called twice: compiled answers as plain.
class A {
  constructor() {
    A.n = (A.n ?? 0) + 1;
  }
}
class B extends A {
  constructor() {
    super();
    try {
      super();
    } catch (e) {
      this.e = e.constructor.name;
    }
  }
}
console.log(new B().e, A.n);
