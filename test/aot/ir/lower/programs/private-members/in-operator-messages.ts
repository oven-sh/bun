// RUN: lower
// OPTIONS: builtin-modules

// `#name in value` where the value is not an object: a static method or accessor has a message of its own, every other private name has the message of the `in` operator, which describes the value. An `accessor` field counts as a field.
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).name + ": " + (e as Error).message; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }

class C {
  static fieldBeforeItsInitializer = #field in C;
  static accessorFieldBeforeItsInitializer = #accessorField in C;
  static methodBeforeTheInitializers = #method in C;
  static #field = 1;
  static accessor #accessorField = 2;
  static #method(): void {}
  static get #getter(): number { return 1; }
  #instance = 1;
  accessor #instanceAccessorField = 2;
  static hasField(v: any): boolean { return #field in v; }
  static hasAccessorField(v: any): boolean { return #accessorField in v; }
  static hasMethod(v: any): boolean { return #method in v; }
  static hasGetter(v: any): boolean { return #getter in v; }
  static hasInstance(v: any): boolean { return #instance in v; }
  static hasInstanceAccessorField(v: any): boolean { return #instanceAccessorField in v; }
}
type Ask = "hasField" | "hasAccessorField" | "hasMethod" | "hasGetter" | "hasInstance" | "hasInstanceAccessorField";
const asks: Ask[] = ["hasField", "hasAccessorField", "hasMethod", "hasGetter", "hasInstance", "hasInstanceAccessorField"];
const values: [string, unknown][] = [["a number", 1], ["a string", "s"], ["null", null], ["undefined", undefined], ["true", true], ["a symbol", Symbol("described")], ["a bigint", 1n],
  ["the class", C], ["an instance", new C()], ["an object", {}], ["a function", () => 1]];
for (const ask of asks) for (const [name, v] of values) row(ask + " of " + name, () => C[ask](v));
row("a field before its initializer", () => C.fieldBeforeItsInitializer);
row("an accessor field before its initializer", () => C.accessorFieldBeforeItsInitializer);
row("a method before the initializers", () => C.methodBeforeTheInitializers);

// GENERATED: said C #method #getter hasField hasMethod hasInstance
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = PropGet v6 key="name"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v9 = String string=": "
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = PropGet v6 key="message"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v13 = Add v10, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_9]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#getter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_10]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hasField"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v2 = TypeTest v1 testedType=object
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b5(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b3(), notTaken b4(v5)
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v7 = TypeTest v6 testedType=absent
// CHECK-NEXT: v8 = LogicalNot v7
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=boolean site=[[w_11]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: b5(v11) frequency=Unlikely:
// CHECK-NEXT: v12 = PropHas v11 key="#field"
// CHECK-NEXT: Unreachable
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hasMethod"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v2 = RequireObject v1 runtimeError=PrivateStaticTestOfNonObject
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_14]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hasInstance"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_15]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v3 = PrivateHas v1, v2 layout=[[L_8]] field=1
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_15]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
