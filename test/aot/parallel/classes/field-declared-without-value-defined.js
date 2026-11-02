// A field declared without a value is defined on the object that the class above answers.
class Z {
  b;
  constructor(b) {
    this.b = b;
  }
  text() {
    return this.b.toUpperCase();
  }
}
const kept = new Z("kept");
class A {
  constructor() {
    return kept;
  }
}
class B extends A {
  b;
  constructor(v) {
    super();
    if (v) this.b = v;
  }
}
console.log(kept.text());
for (let i = 0; i < 12; i++) new B("x" + i);
console.log(kept.text());
new B();
console.log(kept.b, typeof kept.b);
