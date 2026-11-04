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
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="globalThis" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="x"
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2()
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="x" [isFreeName]
// CHECK-NEXT: v9 = Call v8 calleeName="x"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = Integer integer=7
// CHECK-NEXT: PropSet v0, v10 key="id"
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: v13 = ForInOpen v12
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v15 = ForInStep v13, v12
// CHECK-NEXT: v16 = ResultAt v15
// CHECK-NEXT: v17 = ResultAt v15 index=1
// CHECK-NEXT: Branch v16 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v0 key="id"
// CHECK-NEXT: v24 = Call v22, v20, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: b5():
// CHECK-NEXT: v26 = Integer integer=1
// CHECK-NEXT: ElemSet v0, v17, v26
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: }
