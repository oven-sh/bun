// RUN: lower
// OPTIONS: builtin-modules

// The prototype property of a plain function is read and stored under a key that is put together at run time.
function Meter() {}
const key = ["proto", "type"].join(process.argv.length > 99 ? "x" : "");
Meter[key].read = function () { return "read"; };
const first = new Meter().read();
Meter[key] = { read() { return 2; } };
console.log(first, new Meter().read(), Meter.prototype === Meter[key]);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="join"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=Process
// CHECK-NEXT: v7 = PropGet v6 key="argv"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Integer integer=99
// CHECK-NEXT: v12 = Greater v10, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = String string="x"
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3():
// CHECK-NEXT: v14 = String string=""
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = Call v5, v3, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v18 = ElemGet v1, v17
// CHECK-NEXT: v19 = NewClosure function=[[f_4]]
// CHECK-NEXT: PropSet v18, v19 key="read"
// CHECK-NEXT: v21 = Construct v1 calleeName="Meter"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="read"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v25 = Call v24, v22 calleeKey="read" calleeName="read"
// CHECK-NEXT: v26 = NewClosure function=[[f_6]]
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v28 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v28, v27 key="read"
// CHECK-NEXT: v30 = FinishObject v28
// CHECK-NEXT: ElemSet v1, v17, v30
// CHECK-NEXT: v32 = Builtin builtin=GlobalThis
// CHECK-NEXT: v33 = PropGet v32 key="console" [isFreeName]
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="log"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v37 = Construct v1 calleeName="Meter"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="read"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v40, v38 calleeKey="read" calleeName="read"
// CHECK-NEXT: v42 = PropGet v1 key="prototype"
// CHECK-NEXT: v43 = ElemGet v1, v17
// CHECK-NEXT: v44 = StrictEq v42, v43
// CHECK-NEXT: v45 = Call v36, v34, v25, v41, v44 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v46 = Undefined
// CHECK-NEXT: Return v46
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Meter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="read"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
