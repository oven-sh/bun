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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v4 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v5 = String string="{{*}}/lower/programs/commonjs/this-at-top-of-cjs-as-eval-reads-it.cjs"
// CHECK-NEXT: v6 = String string="{{*}}/lower/programs/commonjs"
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
// CHECK-NEXT: v9 = CreateMappedArguments v1, v2, v8, v3, v4, v5, v6, v7
// CHECK-NEXT: v10 = ToThis v0
// CHECK-NEXT: v11 = NewObject layout=[[L_1]]
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: SetLiteralPrototype v11, v12
// CHECK-NEXT: v14 = FinishObject v11
// CHECK-NEXT: v15 = NewObject -, v9 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v16 = ScopeHasBinding v14 key="console"
// CHECK-NEXT: Branch v16 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Jump -> next b3(v14, v17)
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Jump -> next b3(v18, v18)
// CHECK-NEXT: b3(v19, v20):
// CHECK-NEXT: v21 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v21 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v22):
// CHECK-NEXT: v23 = PropGet v22 key="console"
// CHECK-NEXT: Jump -> next b6(v23)
// CHECK-NEXT: b5(v24):
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v27)
// CHECK-NEXT: b6(v28):
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
// CHECK-NEXT: Branch v40 -> taken b7(), notTaken b8()
// CHECK-NEXT: b7():
// CHECK-NEXT: v41 = Undefined
// CHECK-NEXT: Jump -> next b9(v14, v41)
// CHECK-NEXT: b8():
// CHECK-NEXT: v42 = Undefined
// CHECK-NEXT: Jump -> next b9(v42, v42)
// CHECK-NEXT: b9(v43, v44):
// CHECK-NEXT: v45 = TypeTest v43 testedType=object
// CHECK-NEXT: Branch v45 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v46):
// CHECK-NEXT: v47 = PropGet v46 key="globalThis"
// CHECK-NEXT: Jump -> next b12(v47)
// CHECK-NEXT: b11(v48):
// CHECK-NEXT: v49 = Builtin builtin=GlobalThis
// CHECK-NEXT: v50 = PropGet v49 key="globalThis" [isFreeName]
// CHECK-NEXT: v51 = Convert v50 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b12(v51)
// CHECK-NEXT: b12(v52):
// CHECK-NEXT: v53 = StrictEq v10, v52
// CHECK-NEXT: v54 = Boolean
// CHECK-NEXT: v55 = String string="object"
// CHECK-NEXT: v56 = Call v30, v28, v32, v36, v39, v53, v54, v55 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v57 = NewClosure v10, v9 function=[[f_5]]
// CHECK-NEXT: PutModuleVariable v57 variable=[[g_6]]
// CHECK-NEXT: v59 = ScopeHasBinding v14 key="console"
// CHECK-NEXT: Branch v59 -> taken b13(), notTaken b14()
// CHECK-NEXT: b13():
// CHECK-NEXT: v60 = Undefined
// CHECK-NEXT: Jump -> next b15(v14, v60)
// CHECK-NEXT: b14():
// CHECK-NEXT: v61 = Undefined
// CHECK-NEXT: Jump -> next b15(v61, v61)
// CHECK-NEXT: b15(v62, v63):
// CHECK-NEXT: v64 = TypeTest v62 testedType=object
// CHECK-NEXT: Branch v64 -> taken b16(| 0), notTaken b17(| 0)
// CHECK-NEXT: b16(v65):
// CHECK-NEXT: v66 = PropGet v65 key="console"
// CHECK-NEXT: Jump -> next b18(v66)
// CHECK-NEXT: b17(v67):
// CHECK-NEXT: v68 = Builtin builtin=GlobalThis
// CHECK-NEXT: v69 = PropGet v68 key="console" [isFreeName]
// CHECK-NEXT: v70 = Convert v69 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b18(v70)
// CHECK-NEXT: b18(v71):
// CHECK-NEXT: v72 = PropGet v71 key="log"
// CHECK-NEXT: v73 = Convert v72 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v74 = Call v57 calleeName="arrow"
// CHECK-NEXT: v75 = NewClosure v14 function=[[f_7]]
// CHECK-NEXT: v76 = Call v75
// CHECK-NEXT: v77 = ScopeHasBinding v14 key="eval"
// CHECK-NEXT: Branch v77 -> taken b19(), notTaken b20()
// CHECK-NEXT: b19():
// CHECK-NEXT: v78 = Undefined
// CHECK-NEXT: Jump -> next b21(v14, v78)
// CHECK-NEXT: b20():
// CHECK-NEXT: v79 = Undefined
// CHECK-NEXT: Jump -> next b21(v79, v79)
// CHECK-NEXT: b21(v80, v81):
// CHECK-NEXT: v82 = TypeTest v80 testedType=object
// CHECK-NEXT: Branch v82 -> taken b22(| 0), notTaken b23(| 0)
// CHECK-NEXT: b22(v83):
// CHECK-NEXT: v84 = PropGet v83 key="eval"
// CHECK-NEXT: Jump -> next b24(v84)
// CHECK-NEXT: b23(v85):
// CHECK-NEXT: v86 = Builtin builtin=GlobalThis
// CHECK-NEXT: v87 = PropGet v86 key="eval" [isFreeName]
// CHECK-NEXT: v88 = Convert v87 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b24(v88)
// CHECK-NEXT: b24(v89):
// CHECK-NEXT: v90 = String string="this === module"
// CHECK-NEXT: v91 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v92 = StrictEq v89, v91
// CHECK-NEXT: Branch v92 -> taken b25(), notTaken b26(| 0)
// CHECK-NEXT: b25():
// CHECK-NEXT: v93 = Undefined
// CHECK-NEXT: v94 = DirectEval v90, v10, v93, v14, v15, v9 evalScope=e0
// CHECK-NEXT: Jump -> next b27(v94)
// CHECK-NEXT: b26(v95):
// CHECK-NEXT: v96 = Call v95, v81, v90 calleeName="eval"
// CHECK-NEXT: Jump -> next b27(v96)
// CHECK-NEXT: b27(v97):
// CHECK-NEXT: v98 = Call v73, v71, v74, v76, v97 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v99 = GetMappedArgument v9 index=2
// CHECK-NEXT: v100 = Convert v99 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v101 = Data data=[[d_8]]
// CHECK-NEXT: PropSet v100, v101 key="exports" mode=Sloppy
// CHECK-NEXT: v103 = ScopeHasBinding v14 key="console"
// CHECK-NEXT: Branch v103 -> taken b28(), notTaken b29()
// CHECK-NEXT: b28():
// CHECK-NEXT: v104 = Undefined
// CHECK-NEXT: Jump -> next b30(v14, v104)
// CHECK-NEXT: b29():
// CHECK-NEXT: v105 = Undefined
// CHECK-NEXT: Jump -> next b30(v105, v105)
// CHECK-NEXT: b30(v106, v107):
// CHECK-NEXT: v108 = TypeTest v106 testedType=object
// CHECK-NEXT: Branch v108 -> taken b31(| 0), notTaken b32(| 0)
// CHECK-NEXT: b31(v109):
// CHECK-NEXT: v110 = PropGet v109 key="console"
// CHECK-NEXT: Jump -> next b33(v110)
// CHECK-NEXT: b32(v111):
// CHECK-NEXT: v112 = Builtin builtin=GlobalThis
// CHECK-NEXT: v113 = PropGet v112 key="console" [isFreeName]
// CHECK-NEXT: v114 = Convert v113 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b33(v114)
// CHECK-NEXT: b33(v115):
// CHECK-NEXT: v116 = PropGet v115 key="log"
// CHECK-NEXT: v117 = Convert v116 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v118 = GetMappedArgument v9 index=2
// CHECK-NEXT: v119 = Convert v118 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v120 = PropGet v119 key="exports"
// CHECK-NEXT: v121 = StrictEq v10, v120
// CHECK-NEXT: v122 = GetMappedArgument v9 index=2
// CHECK-NEXT: v123 = Convert v122 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v124 = StrictEq v10, v123
// CHECK-NEXT: v125 = GetMappedArgument v9
// CHECK-NEXT: v126 = StrictEq v10, v125
// CHECK-NEXT: v127 = Call v117, v115, v121, v124, v126 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v128 = Undefined
// CHECK-NEXT: Return v128
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=anything variableName="this"}, {type=object flags=[IsFromCompiler] variableName="arguments"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: object):
// CHECK-NEXT: v2 = GetMappedArgument v1 index=2
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(ModuleObject) flags=[IsExpected]}
// CHECK-NEXT: v4 = StrictEq v0, v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis] captures=[{type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: object, v1: anything):
// CHECK-NEXT: v2 = ToThis v1
// CHECK-NEXT: v3 = ScopeHasBinding v0 key="globalThis"
// CHECK-NEXT: Branch v3 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Jump -> next b3(v0, v4)
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Jump -> next b3(v5, v5)
// CHECK-NEXT: b3(v6, v7):
// CHECK-NEXT: v8 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v8 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = PropGet v9 key="globalThis"
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="globalThis" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v14)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: v16 = StrictEq v2, v15
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
