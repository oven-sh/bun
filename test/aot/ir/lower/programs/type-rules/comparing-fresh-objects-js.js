// RUN: lower
// OPTIONS: builtin-modules

// In plain JavaScript, TypeScript's advice that two fresh objects are never equal (TS2839) is a warning: the program is valid and is built.
console.log({} !== {}, [] == [], {} === {}, /a/ != /a/, [1] === [1]);
if ({} === {}) console.log("never");
else console.log("compared by reference");

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
// CHECK-NEXT: v6 = Data data=[[d_2]]
// CHECK-NEXT: v7 = StrictEq v5, v6
// CHECK-NEXT: v8 = LogicalNot v7
// CHECK-NEXT: v9 = Data data=[[d_3]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v11 = Data data=[[d_4]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v13 = Eq v10, v12
// CHECK-NEXT: v14 = Data data=[[d_5]]
// CHECK-NEXT: v15 = Data data=[[d_6]]
// CHECK-NEXT: v16 = StrictEq v14, v15
// CHECK-NEXT: v17 = NewRegExp pattern="a"
// CHECK-NEXT: v18 = NewRegExp pattern="a"
// CHECK-NEXT: v19 = Eq v17, v18
// CHECK-NEXT: v20 = LogicalNot v19
// CHECK-NEXT: v21 = Data data=[[d_7]]
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v23 = Data data=[[d_8]]
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v25 = StrictEq v22, v24
// CHECK-NEXT: v26 = Call v4, v2, v8, v13, v16, v20, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Data data=[[d_9]]
// CHECK-NEXT: v28 = Data data=[[d_10]]
// CHECK-NEXT: v29 = StrictEq v27, v28
// CHECK-NEXT: Branch v29 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = String string="never"
// CHECK-NEXT: v36 = Call v34, v32, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v37 = Builtin builtin=GlobalThis
// CHECK-NEXT: v38 = PropGet v37 key="console" [isFreeName]
// CHECK-NEXT: v39 = Convert v38 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v40 = PropGet v39 key="log"
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v42 = String string="compared by reference"
// CHECK-NEXT: v43 = Call v41, v39, v42 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v44 = Undefined
// CHECK-NEXT: Return v44
// CHECK-NEXT: }
