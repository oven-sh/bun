// Fields declared without a value above classes that a function makes in a loop.
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
const list = [];
for (const Base of [A, B]) list.push(derive(Base));
let t = 0;
for (let i = 0; i < 12; i++) {
  try {
    t += new list[0](2).a + new list[1](3).a;
  } catch (e) {
    t = -1000;
  }
}
console.log(t);
