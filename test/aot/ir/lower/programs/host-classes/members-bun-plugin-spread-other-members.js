// RUN: lower
// OPTIONS: builtin-modules

// Members of bun plugin by a spread between other members.
console.log("a spread between other members", Object.values({ first: 1, ...Bun.plugin, last: () => 2 }).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="a spread between other members"
// CHECK-NEXT: v6 = Builtin builtin=Object
// CHECK-NEXT: v7 = Builtin builtin=ObjectValues
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v10 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v10, v9 key="first"
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="Bun" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Bun) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="plugin"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(BunPlugin) flags=[IsExpected]}
// CHECK-NEXT: CopyDataProperties v10, v16
// CHECK-NEXT: v18 = NewClosure function=[[f_2]]
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v10, v19 key="last"
// CHECK-NEXT: v21 = FinishObject v10
// CHECK-NEXT: v22 = Call v7, v6, v21 calleeName="Object.values"
// CHECK-NEXT: v23 = PropGet v22 key="map"
// CHECK-NEXT: v24 = NewClosure function=[[f_4]]
// CHECK-NEXT: v25 = Call v23, v22, v24 calleeKey="map" calleeName="map"
// CHECK-NEXT: v26 = PropGet v25 key="join"
// CHECK-NEXT: v27 = Call v26, v25 calleeKey="join" calleeName="join"
// CHECK-NEXT: v28 = Call v4, v2, v5, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="last"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|number|[[f_3]]|[[f_5]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|[[f_3]]|[[f_5]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = String string="undefined"
// CHECK-NEXT: Jump -> next b5(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: v6 = TypeTest v5 testedType=function
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = NarrowByTest v0, v7
// CHECK-NEXT: v9 = String string="function "
// CHECK-NEXT: v10 = PropGet v8 key="name"
// CHECK-NEXT: v11 = TypeOf v10
// CHECK-NEXT: v12 = Add v9, v11
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = NarrowByTest v0, v13
// CHECK-NEXT: v15 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v15)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
