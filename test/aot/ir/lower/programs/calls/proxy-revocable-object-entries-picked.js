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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Process
// CHECK-NEXT: v1 = PropGet v0 key="argv"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="length"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Integer integer=99
// CHECK-NEXT: v6 = Less v4, v5
// CHECK-NEXT: v7 = Builtin builtin=Process
// CHECK-NEXT: v8 = PropGet v7 key="argv"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="length"
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v12 = Integer integer=99
// CHECK-NEXT: v13 = Greater v11, v12
// CHECK-NEXT: v14 = NewArray v6, v13 contents=boolean
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<boolean> flags=[IsExpected]}
// CHECK-NEXT: v16 = IteratorOpen v15
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v18 = IteratorResume v16
// CHECK-NEXT: v19 = ResultAt v18
// CHECK-NEXT: v20 = ResultAt v18 index=1
// CHECK-NEXT: Branch v19 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b11():
// CHECK-NEXT: v22 = Convert v20 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v23 = ToBoolean v22
// CHECK-NEXT: Branch v23 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v24) handler=b11():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v25 = Builtin builtin=ProxyRevocable
// CHECK-NEXT: Jump -> next b10(v25)
// CHECK-NEXT: b8(v26) handler=b11():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b11():
// CHECK-NEXT: v27 = Builtin builtin=ObjectEntries
// CHECK-NEXT: Jump -> next b10(v27)
// CHECK-NEXT: b10(v28) handler=b11():
// CHECK-NEXT: v29 = Data data=[[d_1]]
// CHECK-NEXT: v30 = Data data=[[d_2]]
// CHECK-NEXT: v31 = Call v28, -, v29, v30
// CHECK-NEXT: v32 = Builtin builtin=GlobalThis
// CHECK-NEXT: v33 = PropGet v32 key="console" [isFreeName]
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="log"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v31 key="length"
// CHECK-NEXT: v38 = PropGet v31 key="revoke"
// CHECK-NEXT: v39 = TypeOf v38
// CHECK-NEXT: v40 = Call v36, v34, v37, v39 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v16:
// CHECK-NEXT: v41 = CatchException
// CHECK-NEXT: IteratorClose v16 completion=Throw
// CHECK-NEXT: Rethrow v41
// CHECK-NEXT: }
