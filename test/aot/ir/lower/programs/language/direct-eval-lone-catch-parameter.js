// RUN: lower
// OPTIONS: builtin-modules

// The parameter of catch (e) is the only binding the text of a direct eval can see: every other name is looked up on the global object.
export {};

try {
  throw 1;
} catch (e) {
  console.log(eval("e += 1; [e, typeof missing, Math.max(e, 1)]"), e);
  try {
    eval("missing");
  } catch (error) {
    console.log(error.name);
  }
}

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Throw v0
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v1 = CatchValue
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_1]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="eval" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="e += 1; [e, typeof missing, Math.max(e, 1)]"
// CHECK-NEXT: v12 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v13 = StrictEq v10, v12
// CHECK-NEXT: Branch v13 -> taken b4(), notTaken b5(| 0)
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = DirectEval v11, v14 evalScope=e0
// CHECK-NEXT: Jump -> next b6(v15)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = Call v16, -, v11 calleeName="eval"
// CHECK-NEXT: Jump -> next b6(v17)
// CHECK-NEXT: b6(v18):
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v20 = Call v7, v5, v18, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b12():
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="eval" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v24 = String string="missing"
// CHECK-NEXT: v25 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v26 = StrictEq v23, v25
// CHECK-NEXT: Branch v26 -> taken b8(), notTaken b9(| 0)
// CHECK-NEXT: b8() handler=b12():
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: v28 = DirectEval v24, v27 evalScope=e1
// CHECK-NEXT: Jump -> next b10(v28)
// CHECK-NEXT: b9(v29) handler=b12():
// CHECK-NEXT: v30 = Call v29, -, v24 calleeName="eval"
// CHECK-NEXT: Jump -> next b10(v30)
// CHECK-NEXT: b10(v31) handler=b12():
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b12() role=CatchHandler:
// CHECK-NEXT: v32 = CatchValue
// CHECK-NEXT: v33 = Builtin builtin=GlobalThis
// CHECK-NEXT: v34 = PropGet v33 key="console" [isFreeName]
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="log"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v32 key="name"
// CHECK-NEXT: v39 = Call v37, v35, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: Jump -> next b14()
// CHECK-NEXT: b14():
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
