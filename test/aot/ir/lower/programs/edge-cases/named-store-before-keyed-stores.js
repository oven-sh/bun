// RUN: lower
// OPTIONS: builtin-modules

// `o.id = 7` is not lost when a loop below stores to o by computed keys.
const o = {};
if (globalThis.x) x();
o.id = 7;
for (const k in null) o[k] = 1;
console.log(o.id);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="globalThis" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="x"
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="x" [isFreeName]
// CHECK-NEXT: v10 = Call v9 calleeName="x"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = Integer integer=7
// CHECK-NEXT: v13 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v1, v13 key="id"
// CHECK-NEXT: v15 = Null
// CHECK-NEXT: v16 = ForInOpen v15
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v18 = ForInStep v16, v15
// CHECK-NEXT: v19 = ResultAt v18
// CHECK-NEXT: v20 = ResultAt v18 index=1
// CHECK-NEXT: Branch v19 -> taken b7(), notTaken b8()
// CHECK-NEXT: b7():
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="console" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="log"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v1 key="id"
// CHECK-NEXT: v27 = Convert v26 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v25, v23, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: b8():
// CHECK-NEXT: v30 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v31 = Integer integer=1
// CHECK-NEXT: ElemSet v1, v30, v31
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: }
