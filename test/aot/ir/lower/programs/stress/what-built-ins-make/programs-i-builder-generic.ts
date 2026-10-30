// RUN: lower
// OPTIONS: builtin-modules

// A builder as libraries write it: generic over the definition it is handed; each caller hands a literal of its own shape.
type Base = { name: string; run(x: number): number; cost?: number; readonly label?: string; extra?: unknown };
type Defaults = { enabled(): boolean; cost: number; title(): string };
type Built<D extends Base> = Omit<D, keyof Defaults> & Defaults & { describe(): string };
const DEFAULTS = { enabled: () => true, cost: 1 };
export function build<D extends Base>(def: D): Built<D> {
  const facing = { describe: () => def.name + ":" + (def.cost ?? 0) };
  const built: Built<Base> = Object.assign(
    Object.defineProperties({ ...DEFAULTS, title: () => def.name }, Object.getOwnPropertyDescriptors(def)),
    facing,
  ) as unknown as Built<Base>;
  return built as unknown as Built<D>;
}
const a = build({ name: "a", run: x => x * 2 });
const b = build({ name: "b", cost: 3, get label() { return "[" + this.name + "]"; }, run: x => x * x });
const c = build({ name: "c", extra: [1, 2], run: x => -x, more: 1 });
const d = build({ name: "d", run(x) { return x + 1; }, other: "o", another: { deep: true } });
const e = build(Object.assign({ name: "e", run: (x: number) => x }, JSON.parse('{"parsed":1}')));
console.log([a, b, c, d, e].map(tool => tool.name + " " + tool.describe() + " " + tool.run(3) + " " + Object.keys(tool).join()).join(" | "), b.label);

// GENERATED: build enabled label describe
// CHECK-LABEL: function {{*}}name="build"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=undefined|null|[[L_3]] site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v4 = FinishObject v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Builtin builtin=Object
// CHECK-NEXT: v7 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v8 = Builtin builtin=ObjectDefineProperties
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="DEFAULTS"
// CHECK-NEXT: v11 = NewObject layout=[[L_10]]
// CHECK-NEXT: CopyDataProperties v11, v10
// CHECK-NEXT: v13 = NewClosure v0 function=[[f_11]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropDefine v11, v14 key="title"
// CHECK-NEXT: v16 = FinishObject v11
// CHECK-NEXT: v17 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v18 = Builtin builtin=CompilerHelpersDescribeUnlessOrdinary [isNotReadFromHolder]
// CHECK-NEXT: v19 = Call v18, -, v0
// CHECK-NEXT: v20 = Builtin builtin=CompilerHelpersDefinePropertiesFrom
// CHECK-NEXT: v21 = Call v20, -, v16, v19, v0 calleeName="Object.defineProperties"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[L_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v23 = Call v7, v6, v22, v5 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v23 casts=[{declared={type=undefined|null|[[L_15]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_10]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_10]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_3]] site=[[w_4]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="enabled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=boolean site=[[w_19]]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean site=[[w_19]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=undefined|null|number|string|symbol|bigint|[[L_21]] flags=[IsExpected]} results=[{type=undefined|null|string site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_21]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="["
// CHECK-NEXT: v2 = PropGet v0 key="name"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = String string="]"
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|[[L_1]] site=[[w_2]]}] thisType={type=anything} results=[{type=undefined|null|string site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="name"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_24]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = String string=":"
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = PropGet v0 key="cost"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|number} illTypedCause=Assertion
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: Jump -> next b5(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = Add v4, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
