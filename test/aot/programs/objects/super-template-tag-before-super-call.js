// `super.m` used as a template tag before `super()` has been called throws a ReferenceError.
class A { m() { return this; } }
class C extends A {
  constructor(way) {
    try { if (way === 0) super.m`x`; else if (way === 1) super.m(); else /** @type {any} */ (super.m)(); console.log(way, "no error"); } catch (e) { console.log(way, "before super()", e.constructor.name); }
    super();
    console.log(way, "after", super.m`x` === this, /** @type {any} */ (super.m)() === this);
  }
}
new C(0); new C(1); new C(2);
console.log({ m() { return super.toString``; } }.m());
