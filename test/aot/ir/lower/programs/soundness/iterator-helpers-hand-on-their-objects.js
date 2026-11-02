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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = Data data=[[d_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = NewArray v3 contents=undefined|null|[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|[[L_4]]> flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="values"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v7, v5 calleeKey="values" calleeName="values"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_6]]|Generator flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="map"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v11, v9, v1 calleeKey="map" calleeName="map"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Generator flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="toArray"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v13 calleeKey="toArray" calleeName="toArray"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v18 = Integer
// CHECK-NEXT: v19 = ElemGet v17, v18
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = TypeOf v19
// CHECK-NEXT: v26 = StrictEq v19, v3
// CHECK-NEXT: v27 = Call v24, v22, v25, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = NewArray v3 contents=undefined|null|[[L_4]]
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Array<undefined|null|[[L_4]]> flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="values"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v32 = Call v31, v29 calleeKey="values" calleeName="values"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|[[L_6]]|Generator flags=[IsExpected]}
// CHECK-NEXT: v34 = PropGet v33 key="filter"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v36 = NewClosure function=[[f_10]]
// CHECK-NEXT: v37 = Call v35, v33, v36 calleeKey="filter" calleeName="filter"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|Generator<undefined|null|[[L_4]]> flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="next"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v40, v38 calleeKey="next" calleeName="next"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|[[L_12]] flags=[IsExpected]}
// CHECK-NEXT: v43 = PropGet v42 key="value"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="console" [isFreeName]
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v48 = PropGet v47 key="log"
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v50 = TypeOf v44
// CHECK-NEXT: v51 = StrictEq v44, v3
// CHECK-NEXT: v52 = Call v49, v47, v50, v51 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v53 = Undefined
// CHECK-NEXT: Return v53
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="id"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=true flags=[IsExpected]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_14]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_15]]]
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
