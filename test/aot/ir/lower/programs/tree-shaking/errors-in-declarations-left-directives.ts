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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = PropGet v0 key="b"
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: v4 = PropGet v3 key="noSuchMethod"
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = Data data=[[d_5]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=SuppressedError
// CHECK-NEXT: PutModuleVariable v9 variable=[[g_7]]
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = String string="built and ran"
// CHECK-NEXT: v17 = Call v15, v13, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
