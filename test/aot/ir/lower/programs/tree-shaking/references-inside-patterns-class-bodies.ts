// RUN: lower
// OPTIONS: builtin-modules

// One function per place where an expression hides inside something that is not an expression: defaults and computed keys of patterns, of parameters, of a catch clause and a for-of head; the heritage, the keys, the fields, the static blocks and the accessors of a class.
const log: string[] = [];
function d1() { return "variable default"; } function d2() { return "array default"; } function d3() { return "k"; } function d4() { return "assignment default"; }
function d5() { return "parameter default"; } function d6() { return "k"; } function d7() { return "catch default"; } function d8() { return "for-of default"; }
function d9() { return "nested default"; } function d10() { return "k"; }
function c1() { return class { base() { return "heritage"; } }; } function c2() { return "computedMethod"; } function c3() { return "field"; } function c4() { return "static field"; }
function c5() { log.push("static block"); } function c6() { return "computedField"; } function c7() { return "accessor field"; } function c8() { return "computedGetter"; }
function c9() { return "private field"; } function c10() { return "parameter property"; }

const { a = d1() } = {} as { a?: string };
const [b = d2()] = [] as string[];
const { [d3()]: c } = { k: "computed key of a pattern" } as Record<string, string>;
let e: string | undefined;
({ e = d4() } = {} as { e?: string });
function f(value = d5(), { [d6()]: g }: Record<string, string> = { k: "computed key of a parameter" }) { return value + ", " + g; }
log.push(a, b, c, e!, f());
try { throw {}; } catch ({ message = d7() }: any) { log.push(message); }
for (const { h = d8() } of [{}] as { h?: string }[]) log.push(h);
const { i: { j = d9() } = {} } = {} as { i?: { j?: string } };
let l: string | undefined;
({ [d10()]: l } = { k: "computed key of an assignment" } as Record<string, string>);
log.push(j, l!);

class Everything extends c1() {
  [c2()]() { return "computed method"; }
  field = c3();
  static field = c4();
  static { c5(); }
  // @ts-ignore
  [c6()] = "computed field";
  accessor auto = c7();
  get [c8()]() { return "computed getter"; }
  #hidden = c9();
  hidden() { return this.#hidden; }
  constructor(public property = c10()) { super(); }
}
const all = new Everything() as any;
log.push(all.base(), all.computedMethod(), all.field, Everything.field, all.computedField, all.auto, all.computedGetter, all.hidden(), all.property);
console.log(log.join("\n"));

// GENERATED: c1 Everything auto hidden
// CHECK-LABEL: function {{*}}name="c1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_3]]
// CHECK-NEXT: v1 = NewClass v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewClosure function=[[f_5]]
// CHECK-NEXT: DefineMethod v1, v2 layout=[[L_4]] key="base"
// CHECK-NEXT: v4 = FinishClass v1 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Everything"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v7 = Call v6 calleeName="c10"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5(v9)
// CHECK-NEXT: b5(v10):
// CHECK-NEXT: v11 = GetSuperBase v0
// CHECK-NEXT: v12 = SuperConstruct v11, v1 layout=[[L_10]]
// CHECK-NEXT: v13 = Convert v12 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v14 -> taken b6(| 0), notTaken b14(| 0)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: v16 = CallDirect v13 function=[[f_11]]
// CHECK-NEXT: PropSet v13, v10 key="property"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Jump -> next b12(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b9(| 0), notTaken b13(| 0)
// CHECK-NEXT: b9(v23):
// CHECK-NEXT: v24 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v25) frequency=Unlikely:
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b11(v27):
// CHECK-NEXT: Jump -> next b12(v27)
// CHECK-NEXT: b12(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b13(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=DerivedConstructorResult name="Everything"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b14(v31) frequency=Unlikely:
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="auto"
// CHECK: module=[[m_0]] position={{*}} kind=Getter flags=[HasThis, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_10]] field=4
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="auto"
// CHECK: module=[[m_0]] position={{*}} kind=Setter flags=[HasThis, IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: PrivateSet v0, v3, v2 layout=[[L_10]] field=4
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hidden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_10]] site=[[w_14]]} results=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_10]] field=3
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
