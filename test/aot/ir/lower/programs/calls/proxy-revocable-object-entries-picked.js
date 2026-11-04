// RUN: lower
// OPTIONS: builtin-modules

// Proxy revocable or object entries is picked by a condition and called.
for (const first of [process.argv.length < 99, process.argv.length > 99]) {
  const answer = (first ? Proxy.revocable : Object.entries)({}, {});
  console.log(answer.length, typeof answer.revoke);
}

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Process
// CHECK-NEXT: v1 = PropGet v0 key="argv"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="length"
// CHECK-NEXT: v4 = Integer integer=99
// CHECK-NEXT: v5 = Less v3, v4
// CHECK-NEXT: v6 = Builtin builtin=Process
// CHECK-NEXT: v7 = PropGet v6 key="argv"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = Integer integer=99
// CHECK-NEXT: v11 = Greater v9, v10
// CHECK-NEXT: v12 = NewArray v5, v11 contents=anything
// CHECK-NEXT: v13 = IteratorOpen v12
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v15 = IteratorResume v13
// CHECK-NEXT: v16 = ResultAt v15
// CHECK-NEXT: v17 = ResultAt v15 index=1
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v19 = ToBoolean v17
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v20) handler=b8():
// CHECK-NEXT: v21 = Builtin builtin=ProxyRevocable
// CHECK-NEXT: Jump -> next b7(v21)
// CHECK-NEXT: b6(v22) handler=b8():
// CHECK-NEXT: v23 = Builtin builtin=ObjectEntries
// CHECK-NEXT: Jump -> next b7(v23)
// CHECK-NEXT: b7(v24) handler=b8():
// CHECK-NEXT: v25 = Data data=[[d_1]]
// CHECK-NEXT: v26 = Data data=[[d_2]]
// CHECK-NEXT: v27 = Call v24, -, v25, v26
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="console" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="log"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v27 key="length"
// CHECK-NEXT: v34 = PropGet v27 key="revoke"
// CHECK-NEXT: v35 = TypeOf v34
// CHECK-NEXT: v36 = Call v32, v30, v33, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b8() role=IterationCleanup subject=v13:
// CHECK-NEXT: v37 = CatchException
// CHECK-NEXT: IteratorClose v13 completion=Throw
// CHECK-NEXT: Rethrow v37
// CHECK-NEXT: }
