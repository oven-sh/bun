class A {
  get p() {
    this.z = 1;
    return 7;
  }
}
class C extends A {
  z = 0;
}
class D extends A {
  z = 0;
}
console.log(new D().p);
function run() {
  const c = new C();
  const text = JSON.stringify([c], ["p"]);
  return c.z + text;
}
console.log(run());
