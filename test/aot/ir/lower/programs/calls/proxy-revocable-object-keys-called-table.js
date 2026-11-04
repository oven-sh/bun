// RUN: lower
// OPTIONS: builtin-modules

// Proxy revocable or object keys is called out of a table by index.
for (const index of [Number(process.argv.length > 99), Number(process.argv.length < 99)]) {
  console.log([Object.keys, Proxy.revocable][index]({}, {}).length);
}

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Number
// CHECK-NEXT: v1 = Builtin builtin=Process
// CHECK-NEXT: v2 = PropGet v1 key="argv"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="length"
// CHECK-NEXT: v5 = Integer integer=99
// CHECK-NEXT: v6 = Greater v4, v5
// CHECK-NEXT: v7 = Call v0, -, v6 calleeName="Number"
// CHECK-NEXT: v8 = Builtin builtin=Number
// CHECK-NEXT: v9 = Builtin builtin=Process
// CHECK-NEXT: v10 = PropGet v9 key="argv"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="length"
// CHECK-NEXT: v13 = Integer integer=99
// CHECK-NEXT: v14 = Less v12, v13
// CHECK-NEXT: v15 = Call v8, -, v14 calleeName="Number"
// CHECK-NEXT: v16 = NewArray v7, v15 contents=anything
// CHECK-NEXT: v17 = IteratorOpen v16
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v19 = IteratorResume v17
// CHECK-NEXT: v20 = ResultAt v19
// CHECK-NEXT: v21 = ResultAt v19 index=1
// CHECK-NEXT: Branch v20 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="console" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="log"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v28 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v29 = Builtin builtin=ProxyRevocable
// CHECK-NEXT: v30 = NewArray v28, v29 contents=anything
// CHECK-NEXT: v31 = ElemGet v30, v21
// CHECK-NEXT: v32 = Data data=[[d_1]]
// CHECK-NEXT: v33 = Data data=[[d_2]]
// CHECK-NEXT: v34 = Call v31, v30, v32, v33
// CHECK-NEXT: v35 = PropGet v34 key="length"
// CHECK-NEXT: v36 = Call v27, v25, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v17:
// CHECK-NEXT: v37 = CatchException
// CHECK-NEXT: IteratorClose v17 completion=Throw
// CHECK-NEXT: Rethrow v37
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
