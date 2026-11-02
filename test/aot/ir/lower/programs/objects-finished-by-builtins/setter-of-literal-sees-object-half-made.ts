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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v2 = String string="1"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = NewObject -, v3 layout=[[L_1]] fields=[0]
// CHECK-NEXT: v5 = NewClosure function=[[f_3]]
// CHECK-NEXT: DefineSetter v4, v5 key="probe"
// CHECK-NEXT: v7 = FinishObject v4
// CHECK-NEXT: v8 = Data data=[[d_4]]
// CHECK-NEXT: v9 = Data data=[[d_5]]
// CHECK-NEXT: v10 = Call v1, v0, v7, v8, v9 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_1]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_9]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="half"
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|[[L_11]]} illTypedCause=Assertion
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_10]]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="third"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="RangeError" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="no third"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="RangeError"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|RangeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="probe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_15]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_1]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="seen"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = PropGet v3 key="first"
// CHECK-NEXT: v8 = PropGet v3 key="second"
// CHECK-NEXT: v9 = PropGet v3 key="third"
// CHECK-NEXT: v10 = PropHas v3 key="second"
// CHECK-NEXT: v11 = PropHas v3 key="third"
// CHECK-NEXT: v12 = Builtin builtin=Object
// CHECK-NEXT: v13 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v14 = Call v13, v12, v3 calleeName="Object.keys"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = PropGet v15 key="join"
// CHECK-NEXT: v17 = String string="+"
// CHECK-NEXT: v18 = Call v16, v15, v17 calleeKey="join" calleeName="join"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = NewArray v1, v7, v8, v9, v10, v11, v19 contents=undefined|null|boolean|string
// CHECK-NEXT: v21 = PropGet v20 key="join"
// CHECK-NEXT: v22 = Call v21, v20 calleeKey="join" calleeName="join"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_19]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = Call v6, v5, v23 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v25 = Convert v24 declared={type=number site=[[w_20]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
