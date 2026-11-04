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
// CHECK-NEXT: v10 = Data data=[[d_4]]
// CHECK-NEXT: v11 = Eq v9, v10
// CHECK-NEXT: v12 = Data data=[[d_5]]
// CHECK-NEXT: v13 = Data data=[[d_6]]
// CHECK-NEXT: v14 = StrictEq v12, v13
// CHECK-NEXT: v15 = NewRegExp pattern="a"
// CHECK-NEXT: v16 = NewRegExp pattern="a"
// CHECK-NEXT: v17 = Eq v15, v16
// CHECK-NEXT: v18 = LogicalNot v17
// CHECK-NEXT: v19 = Data data=[[d_7]]
// CHECK-NEXT: v20 = Data data=[[d_8]]
// CHECK-NEXT: v21 = StrictEq v19, v20
// CHECK-NEXT: v22 = Call v4, v2, v8, v11, v14, v18, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Data data=[[d_9]]
// CHECK-NEXT: v24 = Data data=[[d_10]]
// CHECK-NEXT: v25 = StrictEq v23, v24
// CHECK-NEXT: Branch v25 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = String string="never"
// CHECK-NEXT: v32 = Call v30, v28, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v33 = Builtin builtin=GlobalThis
// CHECK-NEXT: v34 = PropGet v33 key="console" [isFreeName]
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="log"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v38 = String string="compared by reference"
// CHECK-NEXT: v39 = Call v37, v35, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
