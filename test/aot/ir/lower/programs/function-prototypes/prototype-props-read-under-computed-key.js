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
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = PropGet v2 key="join"
// CHECK-NEXT: v4 = Builtin builtin=Process
// CHECK-NEXT: v5 = PropGet v4 key="argv"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="length"
// CHECK-NEXT: v8 = Integer integer=99
// CHECK-NEXT: v9 = Greater v7, v8
// CHECK-NEXT: Branch v9 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v10 = String string="x"
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = String string=""
// CHECK-NEXT: Jump -> next b3(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = Call v3, v2, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = ElemGet v1, v13
// CHECK-NEXT: v15 = NewClosure function=[[f_3]]
// CHECK-NEXT: PropSet v14, v15 key="read"
// CHECK-NEXT: v17 = Construct v1 calleeName="Meter"
// CHECK-NEXT: v18 = PropGet v17 key="read"
// CHECK-NEXT: v19 = Call v18, v17 calleeKey="read" calleeName="read"
// CHECK-NEXT: v20 = NewClosure function=[[f_4]]
// CHECK-NEXT: v21 = NewObject -, v20 layout=[[L_5]] fields=[0]
// CHECK-NEXT: v22 = FinishObject v21
// CHECK-NEXT: ElemSet v1, v13, v22
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="console" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="log"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v29 = Construct v1 calleeName="Meter"
// CHECK-NEXT: v30 = PropGet v29 key="read"
// CHECK-NEXT: v31 = Call v30, v29 calleeKey="read" calleeName="read"
// CHECK-NEXT: v32 = PropGet v1 key="prototype"
// CHECK-NEXT: v33 = ElemGet v1, v13
// CHECK-NEXT: v34 = StrictEq v32, v33
// CHECK-NEXT: v35 = Call v28, v26, v19, v31, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Meter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="read"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=2
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
