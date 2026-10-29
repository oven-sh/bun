// RUN: lower
// OPTIONS: builtin-modules

// As its neighbor that reads the message: the handler compares, converts and asks for the type of what it gets.
Promise.resolve(Symbol.iterator).then(Math.abs).catch(e => console.log("" + e, e === undefined, typeof e));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Promise" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="resolve"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=SymbolIterator
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Promise<undefined|null|symbol> flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="then"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Builtin builtin=MathAbs
// CHECK-NEXT: v11 = Call v9, v7, v10 calleeKey="then" calleeName="then"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Promise<number> flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="catch"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v15 = NewClosure function=[[f_3]]
// CHECK-NEXT: v16 = Call v14, v12, v15 calleeKey="catch" calleeName="catch"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string=""
// CHECK-NEXT: v7 = Add v6, v0
// CHECK-NEXT: v8 = TypeTest v0 testedType=undefined
// CHECK-NEXT: v9 = TypeOf v0
// CHECK-NEXT: v10 = Call v5, v3, v7, v8, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
