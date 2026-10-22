// closures whose text is the same to the letter over different variables
function makeA() { let n = 1.5; return () => n; } function makeB() { let n = 2.5; return () => n; }
function counterA() { let n = 0; return () => ++n; } function counterB() { let n = 0; return () => ++n; }
const a = counterA(), b = counterB(), a2 = counterA(); a(); a(); b();
console.log(makeA()(), makeB()(), a(), b(), a2());
const getters = [{ get v() { return this.w; }, w: 1.5 }, { get v() { return this.w; }, w: 2.5 }]; console.log(getters[0].v, getters[1].v);
class P { static tag = 1.5; static read() { return this.tag; } } class Q { static tag = 2.5; static read() { return this.tag; } } console.log(P.read(), Q.read(), P.read.call(Q));
class S1 { m() { return "s1"; } } class S2 { m() { return "s2"; } } class T1 extends S1 { m() { return super.m(); } } class T2 extends S2 { m() { return super.m(); } } console.log(new T1().m(), new T2().m(), T1.prototype.m.call(new T2()));
function na() { return new.target === na; } function nb() { return new.target === nb; } console.log(String(new na() instanceof na), String(new nb() instanceof nb), Reflect.construct(na, [], nb) instanceof nb);
