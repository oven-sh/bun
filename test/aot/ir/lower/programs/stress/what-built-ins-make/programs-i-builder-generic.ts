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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = Builtin builtin=Object
// CHECK-NEXT: v5 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v6 = Builtin builtin=ObjectDefineProperties
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="DEFAULTS"
// CHECK-NEXT: v9 = NewObject layout=[[L_6]]
// CHECK-NEXT: CopyDataProperties v9, v8
// CHECK-NEXT: v11 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropDefine v9, v12 key="title"
// CHECK-NEXT: v14 = FinishObject v9
// CHECK-NEXT: v15 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v16 = Builtin builtin=CompilerHelpersDescribeUnlessOrdinary [isNotReadFromHolder]
// CHECK-NEXT: v17 = Call v16, -, v0
// CHECK-NEXT: v18 = Builtin builtin=CompilerHelpersDefinePropertiesFrom
// CHECK-NEXT: v19 = Call v18, -, v14, v17, v0 calleeName="Object.defineProperties"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[L_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v21 = Call v5, v4, v20, v3 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v21 casts=[{declared={type=undefined|null|[[L_10]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="enabled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string="["
// CHECK-NEXT: v2 = PropGet v0 key="name"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = String string="]"
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined] variableName="def"}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="name"
// CHECK-NEXT: v2 = String string=":"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = PropGet v0 key="cost"
// CHECK-NEXT: v5 = TypeTest v4 testedType=undefined|null
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3(v8)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = Add v3, v9
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
