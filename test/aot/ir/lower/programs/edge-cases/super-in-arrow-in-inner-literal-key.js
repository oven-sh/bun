// RUN: lower
// OPTIONS: builtin-modules

// `super` in an arrow function in a computed key belongs to the method around the literal, not to the literal.
console.log({ __proto__: { s: "outer" }, m() { return Object.keys({ __proto__: { s: "inner" }, [(() => super.s)()]() {} })[0]; } }.m());

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Data data=[[d_1]]
// CHECK-NEXT: v6 = NewObject layout=[[L_2]]
// CHECK-NEXT: SetLiteralPrototype v6, v5
// CHECK-NEXT: v8 = NewClosure v6 function=[[f_3]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v6, v9 key="m"
// CHECK-NEXT: v11 = FinishObject v6
// CHECK-NEXT: v12 = PropGet v11 key="m"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v13, v11 calleeKey="m" calleeName="m"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v4, v2, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] captures=[{type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: object, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v4 = Data data=[[d_5]]
// CHECK-NEXT: v5 = NewClosure v1, v0 function=[[f_6]]
// CHECK-NEXT: v6 = Call v5
// CHECK-NEXT: v7 = ToPropertyKey v6
// CHECK-NEXT: v8 = NewClosure function=[[f_7]]
// CHECK-NEXT: SetFunctionName v8, v7
// CHECK-NEXT: v10 = NewObject layout=[[L_8]]
// CHECK-NEXT: SetLiteralPrototype v10, v4
// CHECK-NEXT: ElemDefine v10, v7, v8
// CHECK-NEXT: v13 = FinishObject v10
// CHECK-NEXT: v14 = Call v3, v2, v13 calleeName="Object.keys"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = ElemGet v15, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow captures=[{type=anything}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetSuperBase v1
// CHECK-NEXT: v3 = SuperGet v2, v0 key="s"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
