// RUN: lower
// OPTIONS: builtin-modules

// Each line: what `this` is at the top of a CommonJS file: written, in an arrow function, in a function, and in a text that eval runs. The stored output has module.exports in the text too.
console.log(
  this === exports,
  this === module.exports,
  this === module,
  this === globalThis,
  this === undefined,
  typeof this,
);
const arrow = () => this === module;
console.log(
  arrow(),
  (function () {
    return this === globalThis;
  })(),
  eval("this === module"),
);
module.exports = { replaced: true };
console.log(this === module.exports, this === module, this === exports);

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy, IsHiddenInStackTraces] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v4 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v5 = String string="/$bunfs/root/this-at-top-of-cjs-as-eval-reads-it.cjs"
// CHECK-NEXT: v6 = String string="/$bunfs/root"
// CHECK-NEXT: v7 = NewClosure function=[[f_3]]
// CHECK-NEXT: v8 = Integer integer=5
// CHECK-NEXT: v9 = NewArray contents=anything
// CHECK-NEXT: v10 = CallDirect v1, v7, v8, v1, v3, v4, v5, v6, v9 function=[[f_3]]
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] flags=[IsSloppy, HasThis, TakesCallee, HasArgumentCount, HasHiddenRest] length=5 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: int[0, 4294967295], v3: anything, v4: anything, v5: anything, v6: anything, v7: anything, v8: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v9 = CreateMappedArguments v1, v2, v8, v3, v4, v5, v6, v7
// CHECK-NEXT: v10 = ToThis v0
// CHECK-NEXT: v11 = NewObject layout=[[L_1]]
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: SetLiteralPrototype v11, v12
// CHECK-NEXT: v14 = FinishObject v11
// CHECK-NEXT: v15 = NewObject -, v9 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v16 = ScopeHasBinding v14 key="console"
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Jump -> next b4(v14, v17)
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Jump -> next b4(v18, v18)
// CHECK-NEXT: b4(v19, v20):
// CHECK-NEXT: v21 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v21 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v22):
// CHECK-NEXT: v23 = PropGet v22 key="console"
// CHECK-NEXT: Jump -> next b7(v23)
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v27)
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = GetMappedArgument v9
// CHECK-NEXT: v32 = StrictEq v10, v31
// CHECK-NEXT: v33 = GetMappedArgument v9 index=2
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="exports"
// CHECK-NEXT: v36 = StrictEq v10, v35
// CHECK-NEXT: v37 = GetMappedArgument v9 index=2
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v39 = StrictEq v10, v38
// CHECK-NEXT: v40 = ScopeHasBinding v14 key="globalThis"
// CHECK-NEXT: Branch v40 -> taken b8(), notTaken b9()
// CHECK-NEXT: b8():
// CHECK-NEXT: v41 = Undefined
// CHECK-NEXT: Jump -> next b10(v14, v41)
// CHECK-NEXT: b9():
// CHECK-NEXT: v42 = Undefined
// CHECK-NEXT: Jump -> next b10(v42, v42)
// CHECK-NEXT: b10(v43, v44):
// CHECK-NEXT: v45 = TypeTest v43 testedType=object
// CHECK-NEXT: Branch v45 -> taken b11(| 0), notTaken b12(| 0)
// CHECK-NEXT: b11(v46):
// CHECK-NEXT: v47 = PropGet v46 key="globalThis"
// CHECK-NEXT: Jump -> next b13(v47)
// CHECK-NEXT: b12(v48):
// CHECK-NEXT: v49 = Builtin builtin=GlobalThis
// CHECK-NEXT: v50 = PropGet v49 key="globalThis" [isFreeName]
// CHECK-NEXT: v51 = Convert v50 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b13(v51)
// CHECK-NEXT: b13(v52):
// CHECK-NEXT: v53 = StrictEq v10, v52
// CHECK-NEXT: v54 = Boolean
// CHECK-NEXT: v55 = String string="object"
// CHECK-NEXT: v56 = Call v30, v28, v32, v36, v39, v53, v54, v55 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v57 = NewClosure v10, v9 function=[[f_5]]
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v59 = ScopeHasBinding v14 key="console"
// CHECK-NEXT: Branch v59 -> taken b14(), notTaken b15()
// CHECK-NEXT: b14():
// CHECK-NEXT: v60 = Undefined
// CHECK-NEXT: Jump -> next b16(v14, v60)
// CHECK-NEXT: b15():
// CHECK-NEXT: v61 = Undefined
// CHECK-NEXT: Jump -> next b16(v61, v61)
// CHECK-NEXT: b16(v62, v63):
// CHECK-NEXT: v64 = TypeTest v62 testedType=object
// CHECK-NEXT: Branch v64 -> taken b17(| 0), notTaken b18(| 0)
// CHECK-NEXT: b17(v65):
// CHECK-NEXT: v66 = PropGet v65 key="console"
// CHECK-NEXT: Jump -> next b19(v66)
// CHECK-NEXT: b18(v67):
// CHECK-NEXT: v68 = Builtin builtin=GlobalThis
// CHECK-NEXT: v69 = PropGet v68 key="console" [isFreeName]
// CHECK-NEXT: v70 = Convert v69 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b19(v70)
// CHECK-NEXT: b19(v71):
// CHECK-NEXT: v72 = PropGet v71 key="log"
// CHECK-NEXT: v73 = Convert v72 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v74 = Call v58 calleeName="arrow"
// CHECK-NEXT: v75 = Convert v74 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v76 = NewClosure v14 function=[[f_7]]
// CHECK-NEXT: v77 = Call v76
// CHECK-NEXT: v78 = Convert v77 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v79 = ScopeHasBinding v14 key="eval"
// CHECK-NEXT: Branch v79 -> taken b20(), notTaken b21()
// CHECK-NEXT: b20():
// CHECK-NEXT: v80 = Undefined
// CHECK-NEXT: Jump -> next b22(v14, v80)
// CHECK-NEXT: b21():
// CHECK-NEXT: v81 = Undefined
// CHECK-NEXT: Jump -> next b22(v81, v81)
// CHECK-NEXT: b22(v82, v83):
// CHECK-NEXT: v84 = TypeTest v82 testedType=object
// CHECK-NEXT: Branch v84 -> taken b23(| 0), notTaken b24(| 0)
// CHECK-NEXT: b23(v85):
// CHECK-NEXT: v86 = PropGet v85 key="eval"
// CHECK-NEXT: Jump -> next b25(v86)
// CHECK-NEXT: b24(v87):
// CHECK-NEXT: v88 = Builtin builtin=GlobalThis
// CHECK-NEXT: v89 = PropGet v88 key="eval" [isFreeName]
// CHECK-NEXT: v90 = Convert v89 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b25(v90)
// CHECK-NEXT: b25(v91):
// CHECK-NEXT: v92 = String string="this === module"
// CHECK-NEXT: v93 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v94 = StrictEq v91, v93
// CHECK-NEXT: Branch v94 -> taken b26(), notTaken b27(| 0)
// CHECK-NEXT: b26():
// CHECK-NEXT: v95 = Undefined
// CHECK-NEXT: v96 = DirectEval v92, v10, v95, v58, v14, v15, v9 evalScope=e0
// CHECK-NEXT: Jump -> next b28(v96)
// CHECK-NEXT: b27(v97):
// CHECK-NEXT: v98 = Call v97, v83, v92 calleeName="eval"
// CHECK-NEXT: Jump -> next b28(v98)
// CHECK-NEXT: b28(v99):
// CHECK-NEXT: v100 = Call v73, v71, v75, v78, v99 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v101 = GetMappedArgument v9 index=2
// CHECK-NEXT: v102 = Convert v101 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v103 = Data data=[[d_8]]
// CHECK-NEXT: v104 = Convert v103 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v102, v104 key="exports" mode=Sloppy
// CHECK-NEXT: v106 = ScopeHasBinding v14 key="console"
// CHECK-NEXT: Branch v106 -> taken b29(), notTaken b30()
// CHECK-NEXT: b29():
// CHECK-NEXT: v107 = Undefined
// CHECK-NEXT: Jump -> next b31(v14, v107)
// CHECK-NEXT: b30():
// CHECK-NEXT: v108 = Undefined
// CHECK-NEXT: Jump -> next b31(v108, v108)
// CHECK-NEXT: b31(v109, v110):
// CHECK-NEXT: v111 = TypeTest v109 testedType=object
// CHECK-NEXT: Branch v111 -> taken b32(| 0), notTaken b33(| 0)
// CHECK-NEXT: b32(v112):
// CHECK-NEXT: v113 = PropGet v112 key="console"
// CHECK-NEXT: Jump -> next b34(v113)
// CHECK-NEXT: b33(v114):
// CHECK-NEXT: v115 = Builtin builtin=GlobalThis
// CHECK-NEXT: v116 = PropGet v115 key="console" [isFreeName]
// CHECK-NEXT: v117 = Convert v116 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b34(v117)
// CHECK-NEXT: b34(v118):
// CHECK-NEXT: v119 = PropGet v118 key="log"
// CHECK-NEXT: v120 = Convert v119 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v121 = GetMappedArgument v9 index=2
// CHECK-NEXT: v122 = Convert v121 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v123 = PropGet v122 key="exports"
// CHECK-NEXT: v124 = StrictEq v10, v123
// CHECK-NEXT: v125 = GetMappedArgument v9 index=2
// CHECK-NEXT: v126 = Convert v125 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v127 = StrictEq v10, v126
// CHECK-NEXT: v128 = GetMappedArgument v9
// CHECK-NEXT: v129 = StrictEq v10, v128
// CHECK-NEXT: v130 = Call v120, v118, v124, v127, v129 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v131 = Undefined
// CHECK-NEXT: Return v131
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=anything}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything, v1: object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetMappedArgument v1 index=2
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v4 = StrictEq v0, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis] captures=[{type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: object, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ToThis v1
// CHECK-NEXT: v3 = ScopeHasBinding v0 key="globalThis"
// CHECK-NEXT: Branch v3 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Jump -> next b4(v0, v4)
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Jump -> next b4(v5, v5)
// CHECK-NEXT: b4(v6, v7):
// CHECK-NEXT: v8 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v8 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v9):
// CHECK-NEXT: v10 = PropGet v9 key="globalThis"
// CHECK-NEXT: Jump -> next b7(v10)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="globalThis" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v14)
// CHECK-NEXT: b7(v15):
// CHECK-NEXT: v16 = StrictEq v2, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
