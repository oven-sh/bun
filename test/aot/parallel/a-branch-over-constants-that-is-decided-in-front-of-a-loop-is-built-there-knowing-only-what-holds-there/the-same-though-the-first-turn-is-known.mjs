class A {
  constructor() {
    this.a = 1;
    this.kind = "a";
  }
}
class B {
  constructor() {
    this.b = 2;
    this.kind = "b";
  }
}
class C {
  constructor() {
    this.c = 3;
    this.kind = "c";
  }
}
function run(x, n) {
  const isA = x instanceof A;
  let total = 0;
  for (let i = 0; i < 300; i++) {
    if (!(x instanceof B)) break;
    total += isA ? 1 : 2;
  }
  return total;
}

const n = JSON.parse("4");
console.log("SAID", run(new B(), n), run(new A(), n));
