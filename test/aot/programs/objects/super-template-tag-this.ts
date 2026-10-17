// `super.m` used as a template tag or called under a type assertion gets the surrounding code's `this`.
declare const console: any;
type F = (...a: any[]) => any;
class A {
  m(..._: any[]): any { return this; }
  get g(): F { const self = this; return function (this: any) { return [this === self, self]; }; }
  static sm(..._: any[]): any { return this; }
}
class B extends A {
  tag() { return super.m`x` === this; }
  tagIndex() { return super["m"]`x` === this; }
  tagKey(k: string) { return (super[k as "m"])`x` === this; }
  tagArrow() { return (() => super.m`x`)() === this; }
  tagSubstitution() { let n = 0; const r = super.m`a${n++}b${n++}`; return [r === this, n]; }
  bang() { return super.m!() === this; }
  as() { return (super.m as F)() === this; }
  satisfies() { return (super.m satisfies F)() === this; }
  angle() { return (<F>super.m)() === this; }
  asIndex() { return (super["m"] as F)() === this; }
  twice() { return ((super.m as F)!)() === this; }
  getter() { const [same, self] = super.g`x`; return [same, self === this]; }
  plain() { return super.m() === this; }
  parenthesized() { return (super.m)() === this; }
  detached() { const f = super.m; return f() === undefined; }
  comma() { return (0, super.m)() === undefined; }
  static stag() { return super.sm`x` === this; }
  static sbang() { return super.sm!() === this; }
  static sas() { return (super.sm as F)() === this; }
}
const b = new B();
for (const k of ["tag", "tagIndex", "tagArrow", "tagSubstitution", "bang", "as", "satisfies", "angle", "asIndex", "twice", "getter", "plain", "parenthesized", "detached", "comma"] as const) console.log(k, JSON.stringify((b as any)[k]()));
console.log("tagKey", b.tagKey("m"));
for (const k of ["stag", "sbang", "sas"] as const) console.log(k, (B as any)[k]());
const literal: any = { __proto__: { m(this: any) { return this; } }, tag() { return super.m`x` === this; }, as() { return (super.m as F)() === this; }, text() { return super.toString``; } };
console.log("literal", literal.tag(), literal.as(), literal.text());
class C extends A { constructor() { super(); console.log("after super()", super.m`x` === this, (super.m as F)() === this); } }
new C();
