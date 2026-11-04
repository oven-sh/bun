// RUN: lower
// OPTIONS: builtin-modules

// Iterator helpers hand on their objects.
const id = x => x;
const c = { n: 21 };
const out = [c].values().map(id).toArray()[0];
console.log(typeof out, out === c);
const kept = [c].values().filter(() => true).next().value;
console.log(typeof kept, kept === c);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Data data=[[d_2]]
// CHECK-NEXT: v2 = NewArray v1 contents=anything
// CHECK-NEXT: v3 = PropGet v2 key="values"
// CHECK-NEXT: v4 = Call v3, v2 calleeKey="values" calleeName="values"
// CHECK-NEXT: v5 = PropGet v4 key="map"
// CHECK-NEXT: v6 = Call v5, v4, v0 calleeKey="map" calleeName="map"
// CHECK-NEXT: v7 = PropGet v6 key="toArray"
// CHECK-NEXT: v8 = Call v7, v6 calleeKey="toArray" calleeName="toArray"
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = ElemGet v8, v9
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = TypeOf v10
// CHECK-NEXT: v17 = StrictEq v10, v1
// CHECK-NEXT: v18 = Call v15, v13, v16, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = NewArray v1 contents=anything
// CHECK-NEXT: v20 = PropGet v19 key="values"
// CHECK-NEXT: v21 = Call v20, v19 calleeKey="values" calleeName="values"
// CHECK-NEXT: v22 = PropGet v21 key="filter"
// CHECK-NEXT: v23 = NewClosure function=[[f_3]]
// CHECK-NEXT: v24 = Call v22, v21, v23 calleeKey="filter" calleeName="filter"
// CHECK-NEXT: v25 = PropGet v24 key="next"
// CHECK-NEXT: v26 = Call v25, v24 calleeKey="next" calleeName="next"
// CHECK-NEXT: v27 = PropGet v26 key="value"
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="console" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="log"
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v33 = TypeOf v27
// CHECK-NEXT: v34 = StrictEq v27, v1
// CHECK-NEXT: v35 = Call v32, v30, v33, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="id"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
