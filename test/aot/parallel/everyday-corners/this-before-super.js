// This before super: compiled answers as plain.
class A {}
class B extends A {
  constructor(early) {
    if (early) this.x = 1;
    super();
  }
}
try {
  new B(true);
} catch (e) {
  console.log(e.constructor.name);
}
console.log(new B(false) instanceof B);
