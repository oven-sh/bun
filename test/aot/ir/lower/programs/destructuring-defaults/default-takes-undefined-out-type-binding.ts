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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined|null
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = NewRuntimeError runtimeError=NotDestructurable name="c"
// CHECK-NEXT: Throw v5
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = PropGet v6 key="c"
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="Promise" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="resolve"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer integer=2
// CHECK-NEXT: v16 = Call v14, v12, v15 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = Await v17
// CHECK-NEXT: v19 = Convert v18 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v19)
// CHECK-NEXT: b4(v20):
// CHECK-NEXT: Jump -> next b5(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: v22 = PropGet v6 key="d"
// CHECK-NEXT: v23 = TypeTest v22 testedType=undefined
// CHECK-NEXT: Branch v23 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="Promise" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="resolve"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v30 = Integer integer=3
// CHECK-NEXT: v31 = Call v29, v27, v30 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v33 = PropGet v32 key="then"
// CHECK-NEXT: v34 = NewClosure function=[[f_3]]
// CHECK-NEXT: v35 = Call v33, v32, v34 calleeKey="then" calleeName="then"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v37 = Await v36
// CHECK-NEXT: v38 = Convert v37 declared={type=number}
// CHECK-NEXT: Jump -> next b8(v38)
// CHECK-NEXT: b7(v39):
// CHECK-NEXT: Jump -> next b8(v39)
// CHECK-NEXT: b8(v40):
// CHECK-NEXT: v41 = Convert v21 declared={type=number}
// CHECK-NEXT: v42 = Convert v40 declared={type=number}
// CHECK-NEXT: v43 = Builtin builtin=GlobalThis
// CHECK-NEXT: v44 = PropGet v43 key="console" [isFreeName]
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v46 = PropGet v45 key="log"
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v48 = CallDirect v21 function=[[f_4]]
// CHECK-NEXT: v49 = Call v47, v45, v41, v42, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Undefined
// CHECK-NEXT: Return v50
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parameters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|Array<undefined|number> flags=[OmitsNull]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]], v1: undefined|null|Array<undefined|number>):
// CHECK-NEXT: v2 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=NotDestructurable name="j"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = PropGet v5 key="j"
// CHECK-NEXT: v7 = PropGet v5 key="k"
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = Integer integer=8
// CHECK-NEXT: v11 = Convert v10 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: v14 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v14 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: v16 = Data data=[[d_6]]
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array<undefined|number> flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b8(v17)
// CHECK-NEXT: b7(v18):
// CHECK-NEXT: Jump -> next b8(v18)
// CHECK-NEXT: b8(v19):
// CHECK-NEXT: v20 = IteratorOpen v19 elementCount=1 [isDestructuring]
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b14():
// CHECK-NEXT: v21 = IteratorResume v20 stepIndex=0
// CHECK-NEXT: v22 = ResultAt v21
// CHECK-NEXT: v23 = ResultAt v21 index=1
// CHECK-NEXT: v24 = TypeTest v23 testedType=undefined
// CHECK-NEXT: Branch v24 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v25) handler=b14():
// CHECK-NEXT: v26 = Integer integer=9
// CHECK-NEXT: v27 = Convert v26 declared={type=number}
// CHECK-NEXT: Jump -> next b12(v27)
// CHECK-NEXT: b11(v28) handler=b14():
// CHECK-NEXT: Jump -> next b12(v28)
// CHECK-NEXT: b12(v29) handler=b14():
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: IteratorClose v20
// CHECK-NEXT: v31 = Convert v13 declared={type=number}
// CHECK-NEXT: v32 = Convert v29 declared={type=number}
// CHECK-NEXT: v33 = Add v6, v31
// CHECK-NEXT: v34 = Add v33, v32
// CHECK-NEXT: Return v34
// CHECK-NEXT: b14() role=IterationCleanup subject=v20:
// CHECK-NEXT: v35 = CatchException
// CHECK-NEXT: IteratorClose v20 completion=Throw
// CHECK-NEXT: Rethrow v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="captured"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="s"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=anything variableName="c"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
