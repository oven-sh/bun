// STATISTIC: SharedCallsWhoseSilentMembersSleep >= 1
// STATISTIC: SharedCallsWhoseSleepersWereWoken >= 1
class Base { tag() { return 0; } }
class A extends Base { a() { return "a"; } }
class B extends Base { b() { return "b"; } }
class C extends B { c() { return "c"; } }
class D extends Base { d() { return "d"; } }
class E extends C { e() { return "e"; } }
class F extends D { f() { return "f"; } }
const all = [new A(), new B(), new C(), new D(), new E(), new F()];
function pick(i) { return all[i % all.length]; }
function call(x) { return x.late ? x.late(1) : "none"; }
function said() { let s = ""; for (let i = 0; i < all.length; i++) s += call(pick(i)) + ","; return s; }
function who(n) { return "late of " + this.constructor.name + n; }
all[0].late = who;
console.log(said());
all[3].late = who;
console.log(said());
