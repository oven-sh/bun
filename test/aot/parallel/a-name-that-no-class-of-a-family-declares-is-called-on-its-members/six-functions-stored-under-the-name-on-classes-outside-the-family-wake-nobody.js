// STATISTIC: SharedCallsWhoseSilentMembersSleep >= 1
// STATISTIC: SharedCallsWhoseSleepersWereWoken = 0
class Base { tag() { return 0; } }
class A extends Base { a() { return "a"; } }
class B extends Base { b() { return "b"; } }
class C extends B { c() { return "c"; } }
class D extends Base { d() { return "d"; } }
class E extends C { e() { return "e"; } }
class F extends D { f() { return "f"; } }
const all = [new A(), new B(), new C(), new D(), new E(), new F()];
function call(x) { return x.late ? x.late(1) : "none"; }
class P1 { p() { return 1; } } class P2 { p() { return 2; } } class P3 { p() { return 3; } } class P4 { p() { return 4; } } class P5 { p() { return 5; } } class P6 { p() { return 6; } }
function f1(n) { return n + 1; } function f2(n) { return n + 2; } function f3(n) { return n + 3; } function f4(n) { return n + 4; } function f5(n) { return n + 5; } function f6(n) { return n + 6; }
const o1 = new P1(), o2 = new P2(), o3 = new P3(), o4 = new P4(), o5 = new P5(), o6 = new P6();
o1.late = f1; o2.late = f2; o3.late = f3; o4.late = f4; o5.late = f5; o6.late = f6;
let sum = 0;
for (let i = 0; i < 10; i++) sum += o1.late(i) + o2.late(i) + o3.late(i) + o4.late(i) + o5.late(i) + o6.late(i);
console.log(all.map(call).join(), sum);
