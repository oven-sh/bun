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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Number
// CHECK-NEXT: v1 = Builtin builtin=Process
// CHECK-NEXT: v2 = PropGet v1 key="argv"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="length"
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = Integer integer=99
// CHECK-NEXT: v7 = Greater v5, v6
// CHECK-NEXT: v8 = Call v0, -, v7 calleeName="Number"
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = Builtin builtin=Number
// CHECK-NEXT: v11 = Builtin builtin=Process
// CHECK-NEXT: v12 = PropGet v11 key="argv"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="length"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v16 = Integer integer=99
// CHECK-NEXT: v17 = Less v15, v16
// CHECK-NEXT: v18 = Call v10, -, v17 calleeName="Number"
// CHECK-NEXT: v19 = Convert v18 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v20 = NewArray v9, v19 contents=number
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v22 = IteratorOpen v21
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v24 = IteratorResume v22
// CHECK-NEXT: v25 = ResultAt v24
// CHECK-NEXT: v26 = ResultAt v24 index=1
// CHECK-NEXT: Branch v25 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v28 = Convert v26 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v35 = Builtin builtin=ProxyRevocable
// CHECK-NEXT: v36 = NewArray v34, v35 contents=undefined|null|[[f_1]]|[[f_2]]
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|Array<undefined|null|[[f_1]]|[[f_2]]> flags=[IsExpected]}
// CHECK-NEXT: v38 = ElemGet v37, v28
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|[[f_1]]|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v40 = Data data=[[d_3]]
// CHECK-NEXT: v41 = Data data=[[d_4]]
// CHECK-NEXT: v42 = Call v39, v37, v40, v41
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|[[L_5]]|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v43 key="length"
// CHECK-NEXT: v45 = Call v33, v31, v44 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v22:
// CHECK-NEXT: v46 = CatchException
// CHECK-NEXT: IteratorClose v22 completion=Throw
// CHECK-NEXT: Rethrow v46
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] builtinMembers=[ObjectKeys, ProxyRevocable]
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
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] builtinMembers=[ObjectKeys, ProxyRevocable]
