// RUN: lower
// OPTIONS: builtin-modules

// `Object.assign` stores to an indexed accessor of the target through its setter.
const t = Object.assign({ get 1() { return 5; }, set 1(v) {} }, { get b() { return 1; } }, { 1: "x" });
console.log(t[1]);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v2 = NewObject layout=[[L_1]]
// CHECK-NEXT: v3 = NewClosure function=[[f_2]]
// CHECK-NEXT: DefineGetter v2, v3 key="1"
// CHECK-NEXT: v5 = NewClosure function=[[f_3]]
// CHECK-NEXT: DefineSetter v2, v5 key="1"
// CHECK-NEXT: v7 = FinishObject v2
// CHECK-NEXT: v8 = NewObject layout=[[L_1]]
// CHECK-NEXT: v9 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineGetter v8, v9 key="b"
// CHECK-NEXT: v11 = FinishObject v8
// CHECK-NEXT: v12 = Data data=[[d_5]]
// CHECK-NEXT: v13 = Call v1, v0, v7, v11, v12 calleeName="Object.assign"
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = ElemGet v13, v19
// CHECK-NEXT: v21 = Call v18, v16, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=5
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="b"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
