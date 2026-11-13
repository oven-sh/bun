// Under: --aot-check=FlowFixpoint: a store under a written number opens the member's layout, and a member whose layout is open reads, under any name, all that is found beside its fields: what lies under numbers too. Its porter asks the node that the member itself would ask: the check wakes every sleeper and nothing grows.
// STATISTIC: SharedCallsWithDormantMembers >= 1
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
all[3][0] = who;
console.log(said(), all[3][0](2));
