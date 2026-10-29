// RUN: lower
// OPTIONS: builtin-modules

// A generic builder merges defaults with a definition and casts the result to a type that depends on the type parameter.
const DEFAULTS = { isActive: () => true, isSafe: (_input?: unknown) => false, isPassive: (_input?: unknown) => false, label: (_input?: unknown) => "" };
type Defaults = typeof DEFAULTS;
type Keys = keyof Defaults;
interface AnyDef { name: string; create(deps: number): { run(): string }; isActive?(): boolean; isSafe?(input: unknown): boolean; isPassive?(input: unknown): boolean; label?(input: unknown): string }
type Built<D> = Omit<D, Keys | "create"> & { [K in Keys]-?: K extends keyof D ? (undefined extends D[K] ? Defaults[K] : D[K]) : Defaults[K] } & { run(): string };
interface Plugin { name: string; isActive(): boolean; isSafe(input: unknown): boolean; isPassive(input: unknown): boolean; label(input: unknown): string; run(): string }
function build<D extends AnyDef>(def: D): Built<D> {
  const create = def.create;
  const facing = { run: () => create.call(def, 1).run() };
  const built: Plugin = Object.assign(Object.defineProperties({ ...DEFAULTS, label: () => def.name }, Object.getOwnPropertyDescriptors(def)), facing) as unknown as Plugin;
  return built as unknown as Built<D>;
}
export const first = build({ name: "first", create: () => ({ run: () => "ran first" }), isSafe: () => true as const });
export const second = build({ name: "second", create: () => ({ run: () => "ran second" }), label: (input: unknown) => String(input) });
export const third = build({ name: "third", create: () => ({ run: () => "ran third" }) });
console.log(first.name, first.isSafe(), first.isActive(), first.run(), second.label(7), second.isSafe(1), third.isPassive(), third.run());

// GENERATED: build isActive label
// CHECK-LABEL: function {{*}}name="build"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=undefined|null|[[L_3]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="create"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = NewClosure v0, v2 function=[[f_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_7]]|[[f_8]]|[[f_9]]|[[f_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_11]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v10 = Builtin builtin=ObjectDefineProperties
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="DEFAULTS"
// CHECK-NEXT: v13 = NewObject layout=[[L_14]]
// CHECK-NEXT: CopyDataProperties v13, v12
// CHECK-NEXT: v15 = NewClosure v0 function=[[f_15]]
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropDefine v13, v16 key="label"
// CHECK-NEXT: v18 = FinishObject v13
// CHECK-NEXT: v19 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v20 = Builtin builtin=CompilerHelpersDescribeUnlessOrdinary [isNotReadFromHolder]
// CHECK-NEXT: v21 = Call v20, -, v0
// CHECK-NEXT: v22 = Builtin builtin=CompilerHelpersDefinePropertiesFrom
// CHECK-NEXT: v23 = Call v22, -, v18, v21, v0 calleeName="Object.defineProperties"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_17]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v25 = Call v9, v8, v24, v7 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v25 casts=[{declared={type=undefined|null|[[L_19]] site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_14]] site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_14]] site=[[w_22]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_3]] flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isActive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=boolean site=[[w_23]]}] functionTypes={{*}}[[f_24]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=boolean site=[[w_23]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_26]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_28]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="String"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|string site=[[w_29]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|[[L_1]] site=[[w_2]]}] thisType={type=anything} results=[{type=undefined|null|string site=[[w_30]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_31]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="name"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|string site=[[w_32]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
