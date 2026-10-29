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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=undefined|null|Array site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_4]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<undefined|null|object> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v5 = Call v4, v3, v0 calleeName="Object.keys"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|string> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = IteratorOpen v6
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v7
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Convert v2 declared={type=undefined|null|Array site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b11():
// CHECK-NEXT: v13 = Convert v11 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v14 = ElemGet v0, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array site=[[w_9]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v16 = IteratorOpen v15
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v18 = IteratorResume v16
// CHECK-NEXT: v19 = ResultAt v18
// CHECK-NEXT: v20 = ResultAt v18 index=1
// CHECK-NEXT: Branch v19 -> taken b7(), notTaken b8()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b10():
// CHECK-NEXT: v21 = PropGet v2 key="push"
// CHECK-NEXT: v22 = NewDictionary
// CHECK-NEXT: v23 = ToPropertyKey v13
// CHECK-NEXT: ElemDefine v22, v23, v20
// CHECK-NEXT: v25 = Call v21, v2, v22 calleeKey="push" calleeName="out.push"
// CHECK-NEXT: v26 = Convert v25 declared={type=number site=[[w_10]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b10() role=IterationCleanup subject=v16 handler=b11():
// CHECK-NEXT: v27 = CatchException
// CHECK-NEXT: IteratorClose v16 completion=Throw
// CHECK-NEXT: Rethrow v27
// CHECK-NEXT: b11() role=IterationCleanup subject=v7:
// CHECK-NEXT: v29 = CatchException
// CHECK-NEXT: IteratorClose v7 completion=Throw
// CHECK-NEXT: Rethrow v29
// CHECK-NEXT: }
