// RUN: lower
// OPTIONS: builtin-modules

// A setter of the literal sees the object half made.
interface Form {
  first: string;
  second: string;
  third: string;
}
const seen: string[] = [];
function build(): Form {
  return Object.assign(
    {
      first: "1",
      set probe(value: string) {
        const form = this as unknown as Form;
        seen.push([value, form.first, form.second, form.third, "second" in form, "third" in form, Object.keys(form).join("+")].join());
      },
    },
    { second: "2", probe: "a" },
    { third: "3", probe: "b" },
  ) as unknown as Form;
}
const form = build();
console.log(seen.join(" | "));
console.log(form.first + form.second + form.third, Object.keys(form).join());
let failure = "none";
let half: Form | undefined;
try {
  Object.assign(
    {
      first: "1",
      set keep(_: number) {
        half = this as unknown as Form;
      },
    },
    { keep: 0, second: "2" },
    {
      get third(): string {
        throw new RangeError("no third");
      },
    },
  ) as unknown as Form;
} catch (error) {
  failure = (error as Error).message;
}
console.log(failure, half!.first, half!.second, half!.third, Object.keys(half!).join());

// GENERATED: build keep third probe
// CHECK-LABEL: function {{*}}name="build"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v2 = String string="1"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = NewObject -, v3 layout=[[L_1]] fields=[0]
// CHECK-NEXT: v5 = NewClosure function=[[f_2]]
// CHECK-NEXT: DefineSetter v4, v5 key="probe"
// CHECK-NEXT: v7 = FinishObject v4
// CHECK-NEXT: v8 = Data data=[[d_3]]
// CHECK-NEXT: v9 = Data data=[[d_4]]
// CHECK-NEXT: v10 = Call v1, v0, v7, v8, v9 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|null|[[L_5]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="half"
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_6]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="third"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="RangeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="no third"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="RangeError"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|RangeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="probe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="seen"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = PropGet v2 key="first"
// CHECK-NEXT: v7 = PropGet v2 key="second"
// CHECK-NEXT: v8 = PropGet v2 key="third"
// CHECK-NEXT: v9 = PropHas v2 key="second"
// CHECK-NEXT: v10 = PropHas v2 key="third"
// CHECK-NEXT: v11 = Builtin builtin=Object
// CHECK-NEXT: v12 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v13 = Call v12, v11, v2 calleeName="Object.keys"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = PropGet v14 key="join"
// CHECK-NEXT: v16 = String string="+"
// CHECK-NEXT: v17 = Call v15, v14, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v19 = NewArray v1, v6, v7, v8, v9, v10, v18 contents=anything
// CHECK-NEXT: v20 = PropGet v19 key="join"
// CHECK-NEXT: v21 = Call v20, v19 calleeKey="join" calleeName="join"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = Call v5, v4, v22 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v24 = Convert v23 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
