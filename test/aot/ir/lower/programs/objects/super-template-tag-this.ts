// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: A B tagKey tagSubstitution getter
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tagKey"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_4]] site=[[w_5]]} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: [[L_4]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v3 = GetSuperBase v2 homeKind=ClassPrototype
// CHECK-NEXT: v4 = Convert v1 declared={type=undefined|null|"m" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v5 = SuperGet v3, v0, v4
// CHECK-NEXT: v6 = NewTemplateObject templateStrings=[{cooked="x" raw="x"}]
// CHECK-NEXT: v7 = Call v5, v0, v6
// CHECK-NEXT: v8 = StrictEq v7, v0
// CHECK-NEXT: v9 = Convert v8 declared={type=boolean site=[[w_7]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tagSubstitution"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]] site=[[w_10]]} results=[{type=undefined|null|Array<boolean|number> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_12]]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v4 = GetSuperBase v3 homeKind=ClassPrototype
// CHECK-NEXT: v5 = SuperGet v4, v0 key="m"
// CHECK-NEXT: v6 = NewTemplateObject templateStrings=[{cooked="a" raw="a"}, {cooked="b" raw="b"}, {cooked="" raw=""}]
// CHECK-NEXT: v7 = ToNumeric v2
// CHECK-NEXT: v8 = Increment v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_12]]}
// CHECK-NEXT: v10 = ToNumeric v9
// CHECK-NEXT: v11 = Increment v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_12]]}
// CHECK-NEXT: v13 = Call v5, v0, v6, v7, v10 calleeName="super.m"
// CHECK-NEXT: v14 = StrictEq v13, v0
// CHECK-NEXT: v15 = NewArray v14, v12 contents=boolean|number
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array<boolean|number> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]] site=[[w_13]]} results=[{type=undefined|null|Array site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v0 key="g"
// CHECK-NEXT: v4 = NewTemplateObject templateStrings=[{cooked="x" raw="x"}]
// CHECK-NEXT: v5 = Call v3, v0, v4 calleeName="super.g"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: v7 = IteratorOpen v6 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b7():
// CHECK-NEXT: v8 = IteratorResume v7 stepIndex=0
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b7():
// CHECK-NEXT: v11 = IteratorResume v7 stepIndex=1
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b7():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: IteratorClose v7
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v15 = StrictEq v13, v0
// CHECK-NEXT: v16 = NewArray v10, v15 contents=anything
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: b7() role=IterationCleanup subject=v7:
// CHECK-NEXT: v18 = CatchException
// CHECK-NEXT: IteratorClose v7 completion=Throw
// CHECK-NEXT: Rethrow v18
// CHECK-NEXT: }
