// RUN: lower
// OPTIONS: builtin-modules

// An object that is defined by all the descriptors of a list has the length of the list, and a literal holds what a read of it answers.
const f = [1, 2];
const r = Object.defineProperties({}, Object.getOwnPropertyDescriptors(f));
const o = { n: r.length };
console.log(o.n);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v2 = Builtin builtin=ObjectDefineProperties
// CHECK-NEXT: v3 = Data data=[[d_2]]
// CHECK-NEXT: v4 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v5 = Builtin builtin=CompilerHelpersDescribeUnlessOrdinary [isNotReadFromHolder]
// CHECK-NEXT: v6 = Call v5, -, v1
// CHECK-NEXT: v7 = Builtin builtin=CompilerHelpersDefinePropertiesFrom
// CHECK-NEXT: v8 = Call v7, -, v3, v6, v1 calleeName="Object.defineProperties"
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = NewObject -, v9 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v11 = FinishObject v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v12 key="n"
// CHECK-NEXT: v19 = Call v17, v15, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
