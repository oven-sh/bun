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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="create"
// CHECK-NEXT: v2 = NewClosure v0, v1 function=[[f_3]]
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v4 = FinishObject v3
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v7 = Builtin builtin=ObjectDefineProperties
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="DEFAULTS"
// CHECK-NEXT: v10 = NewObject layout=[[L_6]]
// CHECK-NEXT: CopyDataProperties v10, v9
// CHECK-NEXT: v12 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropDefine v10, v13 key="label"
// CHECK-NEXT: v15 = FinishObject v10
// CHECK-NEXT: v16 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v17 = Builtin builtin=CompilerHelpersDescribeUnlessOrdinary [isNotReadFromHolder]
// CHECK-NEXT: v18 = Call v17, -, v0
// CHECK-NEXT: v19 = Builtin builtin=CompilerHelpersDefinePropertiesFrom
// CHECK-NEXT: v20 = Call v19, -, v15, v18, v0 calleeName="Object.defineProperties"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[L_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v22 = Call v6, v5, v21, v4 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v22 casts=[{declared={type=undefined|null|[[L_10]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_2]] flags=[IsExpected, OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isActive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="String"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="label"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined] variableName="def"}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="name"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
