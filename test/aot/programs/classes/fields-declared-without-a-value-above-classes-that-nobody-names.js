class A {
  a;
  constructor(a) {
    this.a = a;
  }
}
class B {
  a;
  constructor(a) {
    this.a = a;
  }
}
function derive(Base) {
  return class extends Base {};
}
let t = 0;
for (let i = 0; i < 12; i++) {
  t += new (derive(A))(2).a + new (derive(B))(3).a;
}
console.log(t);
