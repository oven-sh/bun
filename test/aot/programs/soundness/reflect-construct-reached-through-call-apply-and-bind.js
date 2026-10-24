class A {
  constructor(p) {
    this.x = p;
    this.r = this.m();
  }
  m() {
    return "A.m";
  }
}
class B extends A {
  s = 5;
  m() {
    return "B.m";
  }
}
function report(label, o) {
  console.log(label, o.r, o.x, o.s, o instanceof B, Object.keys(o).join(), o.m());
}
report("call", Reflect.construct.call(null, A, [1], B));
report("apply", Reflect.construct.apply(null, [A, [2], B]));
report("bind", Reflect.construct.bind(null, A, [3])(B));
report("Reflect.apply", Reflect.apply(Reflect.construct, null, [A, [4], B]));
report("call.call", Function.prototype.call.call(Reflect.construct, null, A, [5], B));
const { construct } = Reflect;
report("destructured", construct(A, [6], B));
report("map", [B].map(Reflect.construct.bind(null, A, [7]))[0]);
report("base", new A(8));
