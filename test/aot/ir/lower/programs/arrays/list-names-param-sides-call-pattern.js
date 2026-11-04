// RUN: lower
// OPTIONS: builtin-modules

// A list names a parameter on both sides of a call that stores an int32 to it and a pattern takes it apart.
const f = (n) => { const [x, y, z] = [n, (() => n >>= 1)(), n]; console.log(x, y, z); };
f(5.5);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Double number=5.5
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="f"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v2 = GetEnvironmentField v1 layout=[[L_2]]
// CHECK-NEXT: v3 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v4 = Call v3
// CHECK-NEXT: v5 = GetEnvironmentField v1 layout=[[L_2]]
// CHECK-NEXT: v6 = NewArray v2, v4, v5 contents=anything
// CHECK-NEXT: v7 = IteratorOpen v6 elementCount=3 [isDestructuring]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b3():
// CHECK-NEXT: v8 = IteratorResume v7 stepIndex=0
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: v11 = IteratorResume v7 stepIndex=1
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: v14 = IteratorResume v7 stepIndex=2
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: IteratorClose v7
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v22, v20, v10, v13, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: b3() role=IterationCleanup subject=v7:
// CHECK-NEXT: v25 = CatchException
// CHECK-NEXT: IteratorClose v7 completion=Throw
// CHECK-NEXT: Rethrow v25
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=env [[L_2]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_2]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = RShift v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
