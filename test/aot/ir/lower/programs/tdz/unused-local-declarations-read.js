// RUN: lower
// OPTIONS: builtin-modules

// Each function declares a local binding that nothing reads, and most of the declarations read a let, const or class before it is initialized.
function show(f) {
  try {
    console.log(f.name, f());
  } catch (error) {
    console.log(f.name, error.name);
  }
}
function pure() {}
show(function list() { const v = [v]; return 1; });
show(function letList() { let v = [v]; return 1; });
show(function object() { const v = { a: v }; return 1; });
show(function objectKey() { const v = { [v]: 1 }; return 1; });
show(function classKey() { const v = class { [v]() {} }; return 1; });
show(function classStaticGetterKey() { const v = class { static get [v]() { return 1; } }; return 1; });
show(function classStaticField() { const v = class { static a = v; }; return 1; });
show(function classExtends() { const v = class extends v {}; return 1; });
show(function template() { const v = `${v}`; return 1; });
show(function spread() { const v = [...[v]]; return 1; });
show(function newSet() { const v = new Set([v]); return 1; });
show(function newMap() { const v = new Map([[v, 1]]); return 1; });
show(function typeOf() { const v = typeof v; return 1; });
show(function closureCalled() { const v = (() => v)(); return 1; });
show(function closureCalledInList() { const v = [(() => v)()]; return 1; });
show(function closureKept() { const v = () => v; return 1; });
show(function laterConst() { const w = [v]; const v = 1; return 1; });
show(function laterLet() { const w = [v]; let v = 1; return 1; });
show(function laterClass() { const w = [C]; class C {} return 1; });
show(function classExtendsLater() { class A extends B {} class B {} return 1; });
show(function classExtendsItself() { class A extends A {} return 1; });
show(function classOwnKey() { class A { [A]() {} } return 1; });
show(function classOwnStaticField() { class A { static a = [A]; } return 1; });
show(function block() { { const v = [v]; } return 1; });
show(function loop() { for (let i = 0; i < 2; i++) { const v = [v]; } return 1; });
show(function loopSecondTurn() { for (let i = 0; i < 2; i++) { if (i) { const w = [v]; } const v = 1; } return 1; });
show(function loopHead() { for (let i = [i]; ; ) break; return 1; });
show(function forOfHead() { for (const v of [v]) break; return 1; });
show(function forInHead() { for (const v in { v }) break; return 1; });
show(function switchSameClause() { switch (1) { case 1: const v = 1; const w = [v]; } return 1; });
show(function switchItself() { switch (1) { case 1: const v = [v]; } return 1; });
show(function tryBlock() { try { const v = [v]; } catch (error) { return "caught " + error.name; } return 1; });
show(function patternDefault() { const [a = b, b] = []; return 1; });
show(function objectPatternDefault() { const { a = b, b } = {}; return 1; });
show(function parameterDefault(a = [b], b) { return 1; });
show(function sameStatement() { const a = [b], b = 1; return 1; });
show(function behind() { const v = 1; const w = [v]; return 1; });
show(function markedCall() { const w = /* @__PURE__ */ pure(v); const v = 1; return 1; });

// GENERATED: classStaticGetterKey newSet patternDefault C
// CHECK-LABEL: function {{*}}name="classStaticGetterKey"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_2]]
// CHECK-NEXT: v1 = NewClass v0 layout=[[L_3]]
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = CheckInitialized v2 name="v"
// CHECK-NEXT: v4 = ToPropertyKey v3
// CHECK-NEXT: v5 = NewClosure function=[[f_4]]
// CHECK-NEXT: SetFunctionName v5, v4 methodKind=Getter
// CHECK-NEXT: DefineMethod v1, v5, v4 layout=[[L_3]] side=Static methodKind=Getter
// CHECK-NEXT: v8 = FinishClass v1 layout=[[L_3]]
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="newSet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Set
// CHECK-NEXT: v1 = Construct v0 calleeName="Set"
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = CheckInitialized v2 name="v"
// CHECK-NEXT: v4 = Builtin builtin=SetPrototypeAdd [isNotReadFromHolder]
// CHECK-NEXT: v5 = Call v4, v1, v3
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="patternDefault"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_7]]
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b6():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = TypeTest v4 testedType=undefined
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v6) handler=b6():
// CHECK-NEXT: v7 = Absent
// CHECK-NEXT: v8 = CheckInitialized v7 name="b"
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b3(v9) handler=b6():
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b4(v10) handler=b6():
// CHECK-NEXT: v11 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: Return v15
// CHECK-NEXT: b6() role=IterationCleanup subject=v1:
// CHECK-NEXT: v16 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
