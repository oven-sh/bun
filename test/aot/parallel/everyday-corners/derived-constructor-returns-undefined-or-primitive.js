// Derived constructor returns undefined or primitive: compiled answers as plain.
class A {}
class B extends A {
  constructor(v) {
    super();
    return v;
  }
}
for (const v of [undefined, null, 1, "s", {}]) {
  try {
    console.log(typeof new B(v), new B(v) instanceof B);
  } catch (e) {
    console.log(e.constructor.name);
  }
}
