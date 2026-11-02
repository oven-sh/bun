// Constructor returns another object: compiled answers as plain.
class A {
  constructor() {
    return { other: true };
  }
}
class B extends A {
  f = 1;
  constructor() {
    super();
    this.g = 2;
  }
}
const b = new B();
console.log(JSON.stringify(b), b instanceof B, b instanceof A);
