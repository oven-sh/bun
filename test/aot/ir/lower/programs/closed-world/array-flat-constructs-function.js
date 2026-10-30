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
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|number|Array<number>> flags=[IsExpected]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="Function" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_2]]
// CHECK-NEXT: PropDefine v5, v4 key=@@species
// CHECK-NEXT: v7 = FinishObject v5
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: PropSet v1, v8 key="constructor"
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v1 key="flat"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v16, v1 calleeKey="flat" calleeName="list.flat"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v19 = TypeOf v18
// CHECK-NEXT: v20 = Call v14, v12, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v21 = CatchValue
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="console" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="log"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v21 key="name"
// CHECK-NEXT: v28 = PropGet v21 key="message"
// CHECK-NEXT: v29 = Call v26, v24, v27, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
