class A extends Object {
  constructor() {
    super();
    this.self = () => this;
  }
}

class B extends A {
}
try {
  o(B);
} catch (e) {}
