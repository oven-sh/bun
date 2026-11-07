// Fields declared without a value in two classes above the classes that one function makes.
class Base1_0 {
  a;
  constructor(a: any) {
    this.a = a;
  }
}
class Base1_2 {
  a;
  constructor(a: any) {
    this.a = a;
  }
}
function derive1(Base: any, tag: any) {
  return class extends Base {};
}
const D1_0 = derive1(Base1_0, "first");
const D1_2 = derive1(Base1_2, "third");
function scene1(turn: number) {
  try {
    const Made = D1_0;
    const o = new Made(2);
  } catch (any) {}
}
for (let turn = 0; turn < 12; turn++) {
  const line = scene1(turn);
}
console.log(new D1_0(2).a, new D1_2(3).a);
