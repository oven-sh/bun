// Field initializers run in order and see this: compiled answers as plain.
class A {
  a = 1;
  b = this.a + 1;
  c = (() => this.b + 1)();
  static s = A.name;
  static t = this.s + "!";
}
console.log(JSON.stringify(new A()), A.s, A.t);
