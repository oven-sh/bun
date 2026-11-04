// RUN: lower
// OPTIONS: builtin-modules

// Array.prototype.flat constructs the species of its receiver. That is the only place where the program reaches the Function constructor, which compiles the text of what it is given.
try {
  const list = [1, [2]]; list.constructor = { [Symbol.species]: Function }; console.log(typeof list.flat());
} catch (error) {
  console.log(error.name, error.message);
}

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Function" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v4 = NewObject layout=[[L_2]]
// CHECK-NEXT: PropDefine v4, v3 key=@@species
// CHECK-NEXT: v6 = FinishObject v4
// CHECK-NEXT: PropSet v0, v6 key="constructor"
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v0 key="flat"
// CHECK-NEXT: v14 = Call v13, v0 calleeKey="flat" calleeName="list.flat"
// CHECK-NEXT: v15 = TypeOf v14
// CHECK-NEXT: v16 = Call v12, v10, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v17 = CatchValue
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v17 key="name"
// CHECK-NEXT: v24 = PropGet v17 key="message"
// CHECK-NEXT: v25 = Call v22, v20, v23, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
