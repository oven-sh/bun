// STATISTIC: SharedCallsWithDormantMembers >= 1
// STATISTIC: SharedCallsWithActivatedMembers = 0
class Base { constructor(n) { this.n = n; } }
class A extends Base { a() { return "a" + this.n; } }
class B extends Base { b() { return "b" + this.n; } }
class C extends Base { c() { return "c" + this.n; } }
class D extends Base { d() { return "d" + this.n; } }
class E extends Base { e() { return "e" + this.n; } }
const all = [new Base(0), new A(1), new B(2), new C(3), new D(4), new E(5)];
const never = process.argv.length > 99;
function laid(v) { return "laid on " + this.constructor.name + (v + 1); }
const key = never ? "early" : "late";
all[2][key] = laid;
console.log(all.map(x => (x.late ? x.late(4) : "none")).join());
