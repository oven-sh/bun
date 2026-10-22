// Calls, getters, static reads and absent names that are resolved from a class declaration must follow every later change to the class. Each case has its own classes and runs a hot loop three times. The second run makes one change halfway, through an alias.
let sums;

function run(use, change) {
  sums = { steps: 0, g: 0, missing: 0, s: 0, f: 0, staticMissing: 0, constructors: 0, instances: 0, aM: 0, bM: 0, cM: 0, n: 0, t: 0, declaredStacks: 0, declaredStaticStacks: 0 };
  let outcome = "finished";
  try {
    use(change);
  } catch (error) {
    outcome = error instanceof TypeError ? "TypeError" : "another error";
  }
  return outcome + ": " + Object.entries(sums).map(([name, sum]) => name + " " + sum).join(", ");
}

function doNothing() {}

function check(title, use, getTarget, change) {
  let result;
  const changeThroughAlias = () => {
    for (const alias of [{}, function () {}, getTarget()]) result = change(alias);
  };
  console.log(title);
  console.log("  before " + run(use, doNothing));
  console.log("  during " + run(use, changeThroughAlias));
  console.log("  after " + run(use, doNothing));
  console.log("  the change returned " + result);
}

const otherPrototype = { m() { return 27; }, get g() { return 28; } };
const otherParent = { s() { return 29; }, f: 30 };
class D { m() { return 40; } }

class A1 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B1 extends A1 {}
class C1 extends B1 { m() { return 10 + super.m(); } }
const a1 = new A1();
const b1 = new B1();
const c1 = new C1();
function use1(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b1.g;
    sums.missing += b1.missing ?? 0;
    sums.s += B1.s();
    sums.f += B1.f;
    sums.staticMissing += B1.missing ?? 0;
    if (a1.constructor === A1) sums.constructors++;
    if (b1 instanceof B1) sums.instances++;
    sums.aM += a1.m();
    sums.bM += b1.m();
    sums.cM += c1.m();
  }
}
check("A.prototype.m is replaced", use1, () => A1.prototype, alias => { alias.m = function () { return 20; }; });

class A2 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B2 extends A2 {}
class C2 extends B2 { m() { return 10 + super.m(); } }
const a2 = new A2();
const b2 = new B2();
const c2 = new C2();
function use2(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b2.g;
    sums.missing += b2.missing ?? 0;
    sums.s += B2.s();
    sums.f += B2.f;
    sums.staticMissing += B2.missing ?? 0;
    if (a2.constructor === A2) sums.constructors++;
    if (b2 instanceof B2) sums.instances++;
    sums.aM += a2.m();
    sums.bM += b2.m();
    sums.cM += c2.m();
  }
}
check("A.prototype.m is deleted", use2, () => A2.prototype, alias => delete alias.m);

class A3 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B3 extends A3 {}
class C3 extends B3 { m() { return 10 + super.m(); } }
const a3 = new A3();
const b3 = new B3();
const c3 = new C3();
function use3(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b3.g;
    sums.missing += b3.missing ?? 0;
    sums.s += B3.s();
    sums.f += B3.f;
    sums.staticMissing += B3.missing ?? 0;
    if (a3.constructor === A3) sums.constructors++;
    if (b3 instanceof B3) sums.instances++;
    sums.aM += a3.m();
    sums.bM += b3.m();
    sums.cM += c3.m();
  }
}
check("A.prototype.m becomes an accessor", use3, () => A3.prototype, alias => { Object.defineProperty(alias, "m", { get() { return () => 21; }, configurable: true }); });

class A4 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B4 extends A4 {}
class C4 extends B4 { m() { return 10 + super.m(); } }
const a4 = new A4();
const b4 = new B4();
const c4 = new C4();
function use4(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b4.g;
    sums.missing += b4.missing ?? 0;
    sums.s += B4.s();
    sums.f += B4.f;
    sums.staticMissing += B4.missing ?? 0;
    if (a4.constructor === A4) sums.constructors++;
    if (b4 instanceof B4) sums.instances++;
    sums.aM += a4.m();
    sums.bM += b4.m();
    sums.cM += c4.m();
  }
}
check("B.prototype gets its own m", use4, () => B4.prototype, alias => { alias.m = function () { return 22; }; });

class A5 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B5 extends A5 {}
class C5 extends B5 { m() { return 10 + super.m(); } }
const a5 = new A5();
const b5 = new B5();
const c5 = new C5();
function use5(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b5.g;
    sums.missing += b5.missing ?? 0;
    sums.s += B5.s();
    sums.f += B5.f;
    sums.staticMissing += B5.missing ?? 0;
    if (a5.constructor === A5) sums.constructors++;
    if (b5 instanceof B5) sums.instances++;
    sums.aM += a5.m();
    sums.bM += b5.m();
    sums.cM += c5.m();
  }
}
check("A.prototype gets the absent name", use5, () => A5.prototype, alias => { alias.missing = 23; });

class A6 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B6 extends A6 {}
class C6 extends B6 { m() { return 10 + super.m(); } }
const a6 = new A6();
const b6 = new B6();
const c6 = new C6();
function use6(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b6.g;
    sums.missing += b6.missing ?? 0;
    sums.s += B6.s();
    sums.f += B6.f;
    sums.staticMissing += B6.missing ?? 0;
    if (a6.constructor === A6) sums.constructors++;
    if (b6 instanceof B6) sums.instances++;
    sums.aM += a6.m();
    sums.bM += b6.m();
    sums.cM += c6.m();
  }
}
check("B gets the absent name", use6, () => B6, alias => { alias.missing = 24; });

class A7 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B7 extends A7 {}
class C7 extends B7 { m() { return 10 + super.m(); } }
const a7 = new A7();
const b7 = new B7();
const c7 = new C7();
function use7(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b7.g;
    sums.missing += b7.missing ?? 0;
    sums.s += B7.s();
    sums.f += B7.f;
    sums.staticMissing += B7.missing ?? 0;
    if (a7.constructor === A7) sums.constructors++;
    if (b7 instanceof B7) sums.instances++;
    sums.aM += a7.m();
    sums.bM += b7.m();
    sums.cM += c7.m();
  }
}
check("B gets its own s", use7, () => B7, alias => { alias.s = function () { return 25; }; });

class A8 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B8 extends A8 {}
class C8 extends B8 { m() { return 10 + super.m(); } }
const a8 = new A8();
const b8 = new B8();
const c8 = new C8();
function use8(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b8.g;
    sums.missing += b8.missing ?? 0;
    sums.s += B8.s();
    sums.f += B8.f;
    sums.staticMissing += B8.missing ?? 0;
    if (a8.constructor === A8) sums.constructors++;
    if (b8 instanceof B8) sums.instances++;
    sums.aM += a8.m();
    sums.bM += b8.m();
    sums.cM += c8.m();
  }
}
check("B gets its own f", use8, () => B8, alias => { alias.f = 26; });

class A9 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B9 extends A9 {}
class C9 extends B9 { m() { return 10 + super.m(); } }
const a9 = new A9();
const b9 = new B9();
const c9 = new C9();
function use9(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b9.g;
    sums.missing += b9.missing ?? 0;
    sums.s += B9.s();
    sums.f += B9.f;
    sums.staticMissing += B9.missing ?? 0;
    if (a9.constructor === A9) sums.constructors++;
    if (b9 instanceof B9) sums.instances++;
    sums.aM += a9.m();
    sums.bM += b9.m();
    sums.cM += c9.m();
  }
}
check("B.prototype gets another prototype", use9, () => B9.prototype, alias => { Object.setPrototypeOf(alias, otherPrototype); });

class A10 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B10 extends A10 {}
class C10 extends B10 { m() { return 10 + super.m(); } }
const a10 = new A10();
const b10 = new B10();
const c10 = new C10();
function use10(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b10.g;
    sums.missing += b10.missing ?? 0;
    sums.s += B10.s();
    sums.f += B10.f;
    sums.staticMissing += B10.missing ?? 0;
    if (a10.constructor === A10) sums.constructors++;
    if (b10 instanceof B10) sums.instances++;
    sums.aM += a10.m();
    sums.bM += b10.m();
    sums.cM += c10.m();
  }
}
check("B gets another prototype", use10, () => B10, alias => { Object.setPrototypeOf(alias, otherParent); });

class A11 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B11 extends A11 {}
class C11 extends B11 { m() { return 10 + super.m(); } }
const a11 = new A11();
const b11 = new B11();
const c11 = new C11();
function use11(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b11.g;
    sums.missing += b11.missing ?? 0;
    sums.s += B11.s();
    sums.f += B11.f;
    sums.staticMissing += B11.missing ?? 0;
    if (a11.constructor === A11) sums.constructors++;
    if (b11 instanceof B11) sums.instances++;
    sums.aM += a11.m();
    sums.bM += b11.m();
    sums.cM += c11.m();
  }
}
check("B gets Symbol.hasInstance", use11, () => B11, alias => { Object.defineProperty(alias, Symbol.hasInstance, { value: () => false }); });

class A12 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B12 extends A12 {}
class C12 extends B12 { m() { return 10 + super.m(); } }
const a12 = new A12();
const b12 = new B12();
const c12 = new C12();
function use12(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b12.g;
    sums.missing += b12.missing ?? 0;
    sums.s += B12.s();
    sums.f += B12.f;
    sums.staticMissing += B12.missing ?? 0;
    if (a12.constructor === A12) sums.constructors++;
    if (b12 instanceof B12) sums.instances++;
    sums.aM += a12.m();
    sums.bM += b12.m();
    sums.cM += c12.m();
  }
}
check("A.prototype.constructor is replaced", use12, () => A12.prototype, alias => { alias.constructor = 1; });

class A13 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B13 extends A13 {}
class C13 extends B13 { m() { return 10 + super.m(); } }
const a13 = new A13();
const b13 = new B13();
const c13 = new C13();
function use13(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b13.g;
    sums.missing += b13.missing ?? 0;
    sums.s += B13.s();
    sums.f += B13.f;
    sums.staticMissing += B13.missing ?? 0;
    if (a13.constructor === A13) sums.constructors++;
    if (b13 instanceof B13) sums.instances++;
    sums.aM += a13.m();
    sums.bM += b13.m();
    sums.cM += c13.m();
  }
}
check("A.prototype.g gets another getter", use13, () => A13.prototype, alias => { Object.defineProperty(alias, "g", { get() { return 31; }, configurable: true }); });

class A14 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B14 extends A14 {}
class C14 extends B14 { m() { return 10 + super.m(); } }
const a14 = new A14();
const b14 = new B14();
const c14 = new C14();
function use14(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b14.g;
    sums.missing += b14.missing ?? 0;
    sums.s += B14.s();
    sums.f += B14.f;
    sums.staticMissing += B14.missing ?? 0;
    if (a14.constructor === A14) sums.constructors++;
    if (b14 instanceof B14) sums.instances++;
    sums.aM += a14.m();
    sums.bM += b14.m();
    sums.cM += c14.m();
  }
}
check("A.s is replaced", use14, () => A14, alias => { alias.s = function () { return 32; }; });

class A15 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B15 extends A15 {}
class C15 extends B15 { m() { return 10 + super.m(); } }
const a15 = new A15();
const b15 = new B15();
const c15 = new C15();
function use15(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b15.g;
    sums.missing += b15.missing ?? 0;
    sums.s += B15.s();
    sums.f += B15.f;
    sums.staticMissing += B15.missing ?? 0;
    if (a15.constructor === A15) sums.constructors++;
    if (b15 instanceof B15) sums.instances++;
    sums.aM += a15.m();
    sums.bM += b15.m();
    sums.cM += c15.m();
  }
}
check("A.f is stored", use15, () => A15, alias => { alias.f = 0.5; });

class A16 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B16 extends A16 {}
class C16 extends B16 { m() { return 10 + super.m(); } }
const a16 = new A16();
const b16 = new B16();
const c16 = new C16();
function use16(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b16.g;
    sums.missing += b16.missing ?? 0;
    sums.s += B16.s();
    sums.f += B16.f;
    sums.staticMissing += B16.missing ?? 0;
    if (a16.constructor === A16) sums.constructors++;
    if (b16 instanceof B16) sums.instances++;
    sums.aM += a16.m();
    sums.bM += b16.m();
    sums.cM += c16.m();
  }
}
check("A.f is deleted", use16, () => A16, alias => delete alias.f);

class A17 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B17 extends A17 {}
class C17 extends B17 { m() { return 10 + super.m(); } }
const a17 = new A17();
const b17 = new B17();
const c17 = new C17();
function use17(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b17.g;
    sums.missing += b17.missing ?? 0;
    sums.s += B17.s();
    sums.f += B17.f;
    sums.staticMissing += B17.missing ?? 0;
    if (a17.constructor === A17) sums.constructors++;
    if (b17 instanceof B17) sums.instances++;
    sums.aM += a17.m();
    sums.bM += b17.m();
    sums.cM += c17.m();
  }
}
check("no change: A.name and A.length are read", use17, () => A17, alias => alias.name + " " + alias.length);

class A18 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B18 extends A18 {}
class C18 extends B18 { m() { return 10 + super.m(); } }
const a18 = new A18();
const b18 = new B18();
const c18 = new C18();
function use18(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b18.g;
    sums.missing += b18.missing ?? 0;
    sums.s += B18.s();
    sums.f += B18.f;
    sums.staticMissing += B18.missing ?? 0;
    if (a18.constructor === A18) sums.constructors++;
    if (b18 instanceof B18) sums.instances++;
    sums.aM += a18.m();
    sums.bM += b18.m();
    sums.cM += c18.m();
  }
}
check("no change: A is frozen", use18, () => A18, alias => Object.isFrozen(Object.freeze(alias)));

class A19 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B19 extends A19 {}
class C19 extends B19 { m() { return 10 + super.m(); } }
const a19 = new A19();
const b19 = new B19();
const c19 = new C19();
function use19(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b19.g;
    sums.missing += b19.missing ?? 0;
    sums.s += B19.s();
    sums.f += B19.f;
    sums.staticMissing += B19.missing ?? 0;
    if (a19.constructor === A19) sums.constructors++;
    if (b19 instanceof B19) sums.instances++;
    sums.aM += a19.m();
    sums.bM += b19.m();
    sums.cM += c19.m();
  }
}
check("no change: A.prototype is frozen", use19, () => A19.prototype, alias => Object.isFrozen(Object.freeze(alias)));

class A20 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B20 extends A20 {}
class C20 extends B20 { m() { return 10 + super.m(); } }
const a20 = new A20();
const b20 = new B20();
const c20 = new C20();
function use20(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b20.g;
    sums.missing += b20.missing ?? 0;
    sums.s += B20.s();
    sums.f += B20.f;
    sums.staticMissing += B20.missing ?? 0;
    if (a20.constructor === A20) sums.constructors++;
    if (b20 instanceof B20) sums.instances++;
    sums.aM += a20.m();
    sums.bM += b20.m();
    sums.cM += c20.m();
  }
}
check("no change: the keys of A.prototype are listed", use20, () => A20.prototype, alias => Object.keys(alias).length);

class A21 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B21 extends A21 {}
class C21 extends B21 { m() { return 10 + super.m(); } }
const a21 = new A21();
const b21 = new B21();
const c21 = new C21();
function use21(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b21.g;
    sums.missing += b21.missing ?? 0;
    sums.s += B21.s();
    sums.f += B21.f;
    sums.staticMissing += B21.missing ?? 0;
    if (a21.constructor === A21) sums.constructors++;
    if (b21 instanceof B21) sums.instances++;
    sums.aM += a21.m();
    sums.bM += b21.m();
    sums.cM += c21.m();
  }
}
check("no change: the unrelated class D changes", use21, () => D.prototype, alias => { alias.m = function () { return 41; }; return new D().m(); });

class A22 { m() { return 1; } get g() { return 2; } static s() { return 3; } static f = 4; }
class B22 extends A22 {}
class C22 extends B22 { m() { return 10 + super.m(); } }
const a22 = new A22();
const b22 = new B22();
const c22 = new C22();
function use22(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.g += b22.g;
    sums.missing += b22.missing ?? 0;
    sums.s += B22.s();
    sums.f += B22.f;
    sums.staticMissing += B22.missing ?? 0;
    if (a22.constructor === A22) sums.constructors++;
    if (b22 instanceof B22) sums.instances++;
    sums.aM += a22.m();
    sums.bM += b22.m();
    sums.cM += c22.m();
  }
}
check("no change for a and b: C.prototype.m is replaced", use22, () => C22.prototype, alias => { alias.m = function () { return 42; }; });

class A23 { m() { return 1; } get stack() { return "declared"; } static s() { return 3; } static get stack() { return "declared"; } }
class B23 extends A23 {}
const b23 = new B23();
function use23(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B23.s();
    sums.bM += b23.m();
    if (b23.stack === "declared") sums.declaredStacks++;
    if (B23.stack === "declared") sums.declaredStaticStacks++;
  }
}
check("native code stores stack on B.prototype", use23, () => B23.prototype, alias => { Error.captureStackTrace(alias); });

class A24 { m() { return 1; } get stack() { return "declared"; } static s() { return 3; } static get stack() { return "declared"; } }
class B24 extends A24 {}
const b24 = new B24();
function use24(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B24.s();
    sums.bM += b24.m();
    if (b24.stack === "declared") sums.declaredStacks++;
    if (B24.stack === "declared") sums.declaredStaticStacks++;
  }
}
check("native code stores stack on B", use24, () => B24, alias => { Error.captureStackTrace(alias); });

function computeKey(key) {
  return key;
}

class A25 { m() { return 1; } }
class B25 extends A25 { [computeKey("m")]() { return 2; } }
class C25 extends B25 { n() { return 3; } }
const a25 = new A25();
const c25 = new C25();
function use25(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.aM += a25.m();
    sums.cM += c25.m();
    sums.n += c25.n();
  }
}
check("C.prototype.n is replaced below a computed name that spells m", use25, () => C25.prototype, alias => { alias.n = function () { return 43; }; });

class A26 { [Symbol.iterator]() { return [5][Symbol.iterator](); } m() { return 1; } static [computeKey("u")]() { return 6; } static s() { return 3; } }
class B26 extends A26 { n() { return 2; } static t() { return 4; } }
const b26 = new B26();
function use26(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B26.s();
    sums.t += B26.t();
    sums.bM += b26.m();
    sums.n += b26.n();
  }
}
check("B.prototype.n is replaced below computed names", use26, () => B26.prototype, alias => { alias.n = function () { return 44; }; });
console.log("  computed members " + [...b26].join() + " " + B26.u());

class A27 { [Symbol.iterator]() { return [5][Symbol.iterator](); } m() { return 1; } static [computeKey("u")]() { return 6; } static s() { return 3; } }
class B27 extends A27 { n() { return 2; } static t() { return 4; } }
const b27 = new B27();
function use27(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B27.s();
    sums.t += B27.t();
    sums.bM += b27.m();
    sums.n += b27.n();
  }
}
check("B gets its own s below computed names", use27, () => B27, alias => { alias.s = function () { return 45; }; });

class A28 { [computeKey("k")]() { return 7; } m() { return 1; } static [computeKey("u")]() { return 6; } static s() { return 3; } }
class B28 extends A28 { n() { return 2; } static t() { return 4; } }
const b28 = new B28();
function use28(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B28.s();
    sums.t += B28.t();
    sums.bM += b28.m();
    sums.n += b28.n();
  }
}
check("A.prototype.m is replaced beside a computed name", use28, () => A28.prototype, alias => { alias.m = function () { return 46; }; });

class A29 { m() { return 1; } static s() { return 3; } static get stack() { return "declared"; } }
class B29 extends A29 {}
const b29 = new B29();
function use29(change) {
  for (let i = 0; i < 10000; i++) {
    if (i === 5000) change();
    sums.steps++;
    sums.s += B29.s();
    sums.bM += b29.m();
    if (A29.stack === "declared") sums.declaredStaticStacks++;
    if (B29.stack === "declared") sums.declaredStaticStacks++;
  }
}
check("native code stores stack on A, the parent of B", use29, () => A29, alias => { Error.captureStackTrace(alias); });
