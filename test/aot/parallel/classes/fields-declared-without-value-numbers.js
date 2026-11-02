// Fields declared without a value hold numbers above one made class and texts above another.
class A {
  a;
  b;
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
}
class B {
  a;
  b;
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
}
function derive(Base) {
  return class extends Base {
    sum() {
      return this.a + this.b;
    }
  };
}
const DA = derive(A),
  DB = derive(B);
for (let i = 0; i < 12; i++) {
  const x = new DA(i, 2),
    y = new DB("s" + i, "t");
  if (i > 9) console.log(x.sum(), y.sum(), Object.keys(x).join(), JSON.stringify(y));
}
console.log(new A(1.5, 2).a, new B(null, undefined).b);
