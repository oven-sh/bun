// RUN: lower
// OPTIONS: builtin-modules

// A variable named declare is the target of a loop.
var declare: any;
for (declare of [1, 2]);
console.log(declare);
for (declare in { a: 1, b: 2 });
console.log(declare);
for await (declare of [3, 4]);
console.log(declare);
for (declare; ; ) break;
console.log(declare);
export {};

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b2(v0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v2
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b3(), notTaken b16()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10, v3 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v14 = Data data=[[d_2]]
// CHECK-NEXT: v15 = ForInOpen v14
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v18 = ForInStep v15, v14
// CHECK-NEXT: v19 = ResultAt v18
// CHECK-NEXT: v20 = ResultAt v18 index=1
// CHECK-NEXT: Branch v19 -> taken b5(), notTaken b15()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="console" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="log"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v26 = Call v25, v23, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Data data=[[d_3]]
// CHECK-NEXT: v28 = IteratorOpen v27 iteratorKind=Async
// CHECK-NEXT: Jump -> next b6(v16)
// CHECK-NEXT: b6(v29):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v31 = IteratorResume v28 iteratorKind=Async
// CHECK-NEXT: v32 = ResultAt v31
// CHECK-NEXT: v33 = ResultAt v31 index=1
// CHECK-NEXT: Branch v32 -> taken b7(), notTaken b11()
// CHECK-NEXT: b7():
// CHECK-NEXT: v34 = Builtin builtin=GlobalThis
// CHECK-NEXT: v35 = PropGet v34 key="console" [isFreeName]
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="log"
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v39 = Call v38, v36, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v41 = Builtin builtin=GlobalThis
// CHECK-NEXT: v42 = PropGet v41 key="console" [isFreeName]
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v43 key="log"
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v46 = Call v45, v43, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v47 = Undefined
// CHECK-NEXT: Return v47
// CHECK-NEXT: b11():
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12() handler=b14():
// CHECK-NEXT: v48 = Convert v33 declared={type=number site=[[w_4]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13() handler=b14():
// CHECK-NEXT: Jump -> next b6(v48)
// CHECK-NEXT: b14() role=IterationCleanup subject=v28:
// CHECK-NEXT: v49 = CatchException
// CHECK-NEXT: IteratorClose v28 iteratorKind=Async completion=Throw
// CHECK-NEXT: Rethrow v49
// CHECK-NEXT: b15():
// CHECK-NEXT: Jump -> next b4(v20)
// CHECK-NEXT: b16():
// CHECK-NEXT: Jump -> next b17()
// CHECK-NEXT: b17() handler=b19():
// CHECK-NEXT: v51 = Convert v7 declared={type=number site=[[w_5]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Jump -> next b18()
// CHECK-NEXT: b18() handler=b19():
// CHECK-NEXT: Jump -> next b2(v51)
// CHECK-NEXT: b19() role=IterationCleanup subject=v2:
// CHECK-NEXT: v52 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v52
// CHECK-NEXT: }
