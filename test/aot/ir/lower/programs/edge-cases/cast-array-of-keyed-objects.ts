// RUN: lower
// OPTIONS: builtin-modules

// Objects that are built by a computed key are collected in an array, and the array is cast to an array of records.
declare const console: { log(...values: unknown[]): void };
function rows<T extends Record<string, readonly unknown[]>>(dims: T): Array<{ [K in keyof T]: T[K][number] }> {
  const out: Array<Record<string, unknown>> = [];
  for (const k of Object.keys(dims)) for (const v of dims[k]) out.push({ [k]: v });
  return out as Array<{ [K in keyof T]: T[K][number] }>;
}
for (const { a } of rows({ a: [1, 2] as const })) console.log(a);

// GENERATED: rows
// CHECK-LABEL: function {{*}}name="rows"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<undefined|null|object> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeName="Object.keys"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = IteratorOpen v6
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v7
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v12 = Convert v2 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: Return v12
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: v13 = ElemGet v0, v11
// CHECK-NEXT: v14 = IteratorOpen v13
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = IteratorResume v14
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Branch v17 -> taken b6(), notTaken b7()
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b9():
// CHECK-NEXT: v19 = PropGet v2 key="push"
// CHECK-NEXT: v20 = ToPropertyKey v11
// CHECK-NEXT: v21 = NewObject layout=[[L_2]]
// CHECK-NEXT: ElemDefine v21, v20, v18
// CHECK-NEXT: v23 = FinishObject v21
// CHECK-NEXT: v24 = Call v19, v2, v23 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v25 = Convert v24 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b9() role=IterationCleanup subject=v14 handler=b10():
// CHECK-NEXT: v26 = CatchException
// CHECK-NEXT: IteratorClose v14 completion=Throw
// CHECK-NEXT: Rethrow v26
// CHECK-NEXT: b10() role=IterationCleanup subject=v7:
// CHECK-NEXT: v28 = CatchException
// CHECK-NEXT: IteratorClose v7 completion=Throw
// CHECK-NEXT: Rethrow v28
// CHECK-NEXT: }
