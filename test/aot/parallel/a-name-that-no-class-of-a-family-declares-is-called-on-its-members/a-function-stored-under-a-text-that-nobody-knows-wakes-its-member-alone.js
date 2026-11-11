// Under: --aot-check=FlowFixpoint: a function stored on one member under a text that nobody knows is found beside ITS fields: it wants that member as its receiver, so its porter wakes that member, alone; the check wakes every sleeper and nothing grows.
// STATISTIC: SharedCallsWithDormantMembers >= 1
// STATISTIC: DormantMembersActivated >= 1
class Base { tag() { return 0; } }
class A extends Base { a() { return "a"; } }
class B extends Base { b() { return "b"; } }
class C extends B { c() { return "c"; } }
class D extends Base { d() { return "d"; } }
class E extends C { e() { return "e"; } }
class F extends D { f() { return "f"; } }
const all = [new A(), new B(), new C(), new D(), new E(), new F()];
function who(n) { return "late of " + this.constructor.name + n; }
function call(x) { return x.late ? x.late(1) : "none"; }
function said() { let s = ""; for (let i = 0; i < all.length; i++) s += call(all[i % all.length]) + ","; return s; }
console.log(said());
function tail() { return all.length > 3 ? "te" : "xx"; }
all[1]["la" + tail()] = who;
console.log(said());
