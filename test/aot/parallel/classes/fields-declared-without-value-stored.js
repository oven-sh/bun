// Fields declared without a value are stored by a method of the class that a function makes.
class A {
  a;
  n = 1;
}
class B {
  a;
  n = 2;
}
function derive(Base) {
  return class extends Base {
    set(v) {
      this.a = v;
      return this;
    }
  };
}
const DA = derive(A),
  DB = derive(B);
let t = 0;
for (let i = 0; i < 12; i++) {
  const x = new DA(),
    y = new DB().set(i);
  t += (x.a === undefined ? 1 : 0) + y.a + x.n + y.n;
}
console.log(t, new DA().a, "a" in new DA(), new DB().set("s").a);
