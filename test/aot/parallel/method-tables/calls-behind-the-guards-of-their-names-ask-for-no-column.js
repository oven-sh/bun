// eight classes below one class, eight methods on it, each class calls one of them, and code that nobody sees stores over all eight: the calls stand behind the guards of their names,
// and their failing sides ask for no column of the method table: eight guards end, not eight for each of nine classes, and no word of a table is written
// STATISTIC: MethodTableSelectors = 0
// STATISTIC: MethodTableBytes = 0
// COUNTER: ClassGuardBitsInvalidated = 8
// COUNTER: MethodTablePagesMadeWritable = 0
const replaceAll = (0, eval)('(Base, count) => { for (let k = 0; k < count; k++) Base.prototype["m" + k] = () => 2; }');
class Base { m0() { return 1; } m1() { return 1; } m2() { return 1; } m3() { return 1; } m4() { return 1; } m5() { return 1; } m6() { return 1; } m7() { return 1; } }
class C0 extends Base { } function r0(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.m0(); return t; } const o0 = new C0();
class C1 extends Base { } function r1(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.m1(); return t; } const o1 = new C1();
class C2 extends Base { } function r2(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.m2(); return t; } const o2 = new C2();
class C3 extends Base { } function r3(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.m3(); return t; } const o3 = new C3();
class C4 extends Base { } function r4(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.m4(); return t; } const o4 = new C4();
class C5 extends Base { } function r5(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.m5(); return t; } const o5 = new C5();
class C6 extends Base { } function r6(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.m6(); return t; } const o6 = new C6();
class C7 extends Base { } function r7(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.m7(); return t; } const o7 = new C7();
function all() { return r0(o0) + r1(o1) + r2(o2) + r3(o3) + r4(o4) + r5(o5) + r6(o6) + r7(o7); }
console.log(all());
replaceAll(Base, 8);
console.log(all());
