// RUN: lower
// OPTIONS: builtin-modules

// `// @ts-expect-error` stands above a real type error in the initializer of a constant, in a static field, in a field, in a pattern and in an export, and nothing uses any of them. A build that leaves the declarations out must not call the comments unused.
// @ts-expect-error
const wrongNumber: number = "text";
// @ts-expect-error
const wrongMember = { a: 1 }.b;
class Unused {
  // @ts-expect-error
  static wrong: string = 5;
  // @ts-expect-error
  field: boolean = "no";
}
const unusedObject = {
  // @ts-expect-error
  nested: (1 as number).noSuchMethod,
};
// @ts-expect-error
const [wrongPattern]: [string] = [1];
// @ts-expect-error
export const exportedWrong: string[] = [1, 2];

console.log("built and ran");

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = PropGet v0 key="b"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v4 = PropGet v3 key="noSuchMethod"
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Data data=[[d_3]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutModuleVariable v8 variable=[[g_4]]
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="built and ran"
// CHECK-NEXT: v16 = Call v14, v12, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
