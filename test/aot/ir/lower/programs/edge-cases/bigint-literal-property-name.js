// RUN: lower
// OPTIONS: builtin-modules

// `{ 1n: ++n }` has the property "1", and its value is evaluated.
let n = 0;
console.log({ 1n: ++n }[1], n);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Increment v1
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = NewObject layout=[[L_1]]
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: ElemDefine v9, v10, v8
// CHECK-NEXT: v12 = FinishObject v9
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = ElemGet v12, v13
// CHECK-NEXT: v15 = Call v6, v4, v14, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
