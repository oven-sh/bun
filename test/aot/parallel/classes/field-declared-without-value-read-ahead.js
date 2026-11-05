// A field declared without a value is read ahead of its store above a class that a function makes.
const seen = [];
class A {
  a;
  constructor(a) {
    seen.push(this.a, "a" in this);
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
const DA = derive(A),
  DB = derive(B);
for (let i = 0; i < 12; i++) {
  new DA(i);
  new DB(i);
}
console.log(seen.length, seen[0], seen[1], new DA(3).a, new DB(4).a);
