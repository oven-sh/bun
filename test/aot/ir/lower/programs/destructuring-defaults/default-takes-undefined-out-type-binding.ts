// RUN: lower
// OPTIONS: builtin-modules

// A binding with a default that is never `undefined` has the type of its property without `undefined`.
let { a, b = 1 }: { a: number; b?: number } = { a: 1 };
const fromLiteral: number = b;
console.log(a, fromLiteral);

async function awaits() {
  let { c = await Promise.resolve(2), d = await Promise.resolve(3).then<number, never>((value: number) => value) }: { c?: number; d?: number } = {};
  const read = () => c;
  const fromAwait: number = c;
  const fromThen: number = d;
  console.log(fromAwait, fromThen, read());
}
await awaits();

let [x = 4, y = "s"]: [number?, string?] = [];
const fromList: number = x;
const text: string = y;
console.log(fromList, text);

let { o: { e = 5 } = {}, l: [f = 6] = [] }: { o?: { e?: number }; l?: [number?] } = {};
const nested: number = e;
const nestedInList: number = f;
console.log(nested, nestedInList);

let { g = 7, h = undefined, i = null }: { g: number | undefined; h?: number; i?: number | null } = { g: undefined };
const declaredUndefined: number = g;
const keepsUndefined: number | undefined = h;
const takesNull: number | null = i;
console.log(declaredUndefined, keepsUndefined, takesNull);

function parameters({ j, k = 8 }: { j: number; k?: number }, [m = 9]: [number?] = []) {
  const fromObject: number = k;
  const fromTuple: number = m;
  return j + fromObject + fromTuple;
}
console.log(parameters({ j: 1 }));

let p: number, q: number;
const optional: { p?: number; q?: number } = {};
({ p = 10, q = 11 } = optional);
console.log(p, q);
[p = 12, q = 13] = [] as number[];
console.log(p, q);

const records: { r?: number }[] = [{}, { r: 15 }];
for (const { r = 14 } of records) {
  const inLoop: number = r;
  console.log(inLoop);
}

let { s = 16 }: { s?: number } = {};
const captured = () => s;
s = 17;
const afterStore: number = captured();
console.log(afterStore);
export {};

// GENERATED: awaits parameters captured read
// CHECK-LABEL: function {{*}}name="awaits"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined|null
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v5 = NewRuntimeError runtimeError=NotDestructurable name="c"
// CHECK-NEXT: Throw v5
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: v7 = PropGet v6 key="c"
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined
// CHECK-NEXT: Branch v8 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v9):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="Promise" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="resolve"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer integer=2
// CHECK-NEXT: v16 = Call v14, v12, v15 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = Await v17
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_3]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Jump -> next b8(v19)
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Jump -> next b8(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: v22 = Convert v21 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v23 = PropGet v6 key="d"
// CHECK-NEXT: v24 = TypeTest v23 testedType=undefined
// CHECK-NEXT: Branch v24 -> taken b9(| 0), notTaken b11(| 0)
// CHECK-NEXT: b9(v25):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="Promise" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="resolve"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v31 = Integer integer=3
// CHECK-NEXT: v32 = Call v30, v28, v31 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v34 = PropGet v33 key="then"
// CHECK-NEXT: v35 = NewClosure function=[[f_4]]
// CHECK-NEXT: v36 = Call v34, v33, v35 calleeKey="then" calleeName="then"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v38 = Await v37
// CHECK-NEXT: v39 = Convert v38 declared={type=number site=[[w_5]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Jump -> next b12(v39)
// CHECK-NEXT: b11(v40):
// CHECK-NEXT: Jump -> next b12(v40)
// CHECK-NEXT: b12(v41):
// CHECK-NEXT: v42 = Convert v41 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v43 = NewClosure v22 function=[[f_6]]
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="console" [isFreeName]
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v48 = PropGet v47 key="log"
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v50 = Call v44
// CHECK-NEXT: v51 = Convert v50 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v52 = Call v49, v47, v22, v42, v51 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v53 = Undefined
// CHECK-NEXT: Return v53
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parameters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array<undefined|number> site=[[w_12]] flags=[OmitsNull]}] results=[{type=number site=[[w_13]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_10]], v1: undefined|null|Array<undefined|number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=NotDestructurable name="j"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: v6 = PropGet v5 key="j"
// CHECK-NEXT: v7 = Convert v6 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v8 = PropGet v5 key="k"
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined
// CHECK-NEXT: Branch v9 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v10):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v11 = Integer integer=8
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_14]]}
// CHECK-NEXT: Jump -> next b8(v12)
// CHECK-NEXT: b7(v13):
// CHECK-NEXT: Jump -> next b8(v13)
// CHECK-NEXT: b8(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v16 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v16 -> taken b9(| 0), notTaken b11(| 0)
// CHECK-NEXT: b9(v17):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v18 = Data data=[[d_15]]
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|Array<undefined|number> site=[[w_12]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b12(v19)
// CHECK-NEXT: b11(v20):
// CHECK-NEXT: Jump -> next b12(v20)
// CHECK-NEXT: b12(v21):
// CHECK-NEXT: v22 = IteratorOpen v21 elementCount=1 [isDestructuring]
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13() handler=b21():
// CHECK-NEXT: v23 = IteratorResume v22 stepIndex=0
// CHECK-NEXT: v24 = ResultAt v23
// CHECK-NEXT: v25 = ResultAt v23 index=1
// CHECK-NEXT: v26 = TypeTest v25 testedType=undefined
// CHECK-NEXT: Branch v26 -> taken b14(| 0), notTaken b16(| 0)
// CHECK-NEXT: b14(v27) handler=b21():
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15() handler=b21():
// CHECK-NEXT: v28 = Integer integer=9
// CHECK-NEXT: v29 = Convert v28 declared={type=number site=[[w_16]]}
// CHECK-NEXT: Jump -> next b17(v29)
// CHECK-NEXT: b16(v30) handler=b21():
// CHECK-NEXT: Jump -> next b17(v30)
// CHECK-NEXT: b17(v31) handler=b21():
// CHECK-NEXT: v32 = Convert v31 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b18()
// CHECK-NEXT: b18() handler=b21():
// CHECK-NEXT: Jump -> next b19()
// CHECK-NEXT: b19():
// CHECK-NEXT: IteratorClose v22
// CHECK-NEXT: Jump -> next b20()
// CHECK-NEXT: b20():
// CHECK-NEXT: v34 = Add v7, v15
// CHECK-NEXT: v35 = Add v34, v32
// CHECK-NEXT: v36 = Convert v35 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Return v36
// CHECK-NEXT: b21() role=IterationCleanup subject=v22:
// CHECK-NEXT: v37 = CatchException
// CHECK-NEXT: IteratorClose v22 completion=Throw
// CHECK-NEXT: Rethrow v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="captured"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_17]]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="s"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_17]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=number site=[[w_20]]}] thisType={type=anything} results=[{type=number site=[[w_21]]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_21]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
