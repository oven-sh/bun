// STATISTIC: AccessesUnknown = 0
class A {
  base() {
    return 1;
  }
}
class B extends A {
  base() {
    return super.base() + 1;
  }
}
class C extends B {
  base() {
    return super.base() + 1;
  }
}
class D extends C {
  base() {
    return super.base() + 1;
  }
}
class E extends D {
  base() {
    return super.base() + 1;
  }
}
const deepest = new E();
function turn(i) {
  return deepest.base() + (i & 1);
}
let sum = 0;
for (let i = 0; i < 1000; i++) sum += turn(i);
console.log(sum, new C().base(), new A().base());
