// RUN: lower
// OPTIONS: builtin-modules

// `Object.assign` stores to an indexed accessor of the target through its setter.
const t = Object.assign({ get 1() { return 5; }, set 1(v) {} }, { get b() { return 1; } }, { 1: "x" });
console.log(t[1]);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = ElemGet v14, v20
// CHECK-NEXT: v22 = Call v19, v17, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=5
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="b"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
