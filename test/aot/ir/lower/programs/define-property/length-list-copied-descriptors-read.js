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
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Builtin builtin=ObjectDefineProperties
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = Builtin builtin=ObjectGetOwnPropertyDescriptors
// CHECK-NEXT: v4 = Builtin builtin=CompilerHelpersDescribeUnlessOrdinary [isNotReadFromHolder]
// CHECK-NEXT: v5 = Call v4, -, v0
// CHECK-NEXT: v6 = Builtin builtin=CompilerHelpersDefinePropertiesFrom
// CHECK-NEXT: v7 = Call v6, -, v2, v5, v0 calleeName="Object.defineProperties"
// CHECK-NEXT: v8 = PropGet v7 key="length"
// CHECK-NEXT: v9 = NewObject -, v8 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v10 key="n"
// CHECK-NEXT: v17 = Call v15, v13, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
