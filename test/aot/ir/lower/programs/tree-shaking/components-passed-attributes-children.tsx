// RUN: lower
// OPTIONS: builtin-modules

// Functions that are named only inside JSX: as the value of an attribute, as a child in braces, in a spread attribute and in a spread child.
/* @jsxRuntime classic */
/* @jsx h */
export {};
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

function h(tag: any, props: any, ...children: any[]): string {
  const parts: string[] = [];
  for (const key in props) parts.push(key + "=" + (typeof props[key] === "function" ? props[key]() : props[key]));
  for (const child of children.flat()) parts.push(typeof child === "function" ? child() : child);
  return tag + "(" + parts.join(" ") + ")";
}

function inAttribute() {
  return "attribute";
}
function asChild() {
  return "child";
}
function inSpread() {
  return "spread";
}
function inSpreadChild() {
  return "spread child";
}

console.log(<a render={inAttribute} {...{ other: inSpread }}>{asChild}{...[inSpreadChild]}</a>);

// GENERATED: h inSpread
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Data data=[[d_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Convert v1 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = ForInOpen v5
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = ForInStep v6, v5
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Branch v9 -> taken b3(), notTaken b14()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = PropGet v2 key="flat"
// CHECK-NEXT: v12 = Call v11, v2 calleeKey="flat" calleeName="children.flat"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = IteratorOpen v13
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = IteratorResume v14
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Branch v17 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v19 = String string="("
// CHECK-NEXT: v20 = Add v0, v19
// CHECK-NEXT: v21 = PropGet v4 key="join"
// CHECK-NEXT: v22 = String string=" "
// CHECK-NEXT: v23 = Call v21, v4, v22 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v25 = Add v20, v24
// CHECK-NEXT: v26 = String string=")"
// CHECK-NEXT: v27 = Add v25, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v28
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b13():
// CHECK-NEXT: v29 = PropGet v4 key="push"
// CHECK-NEXT: v30 = TypeTest v18 testedType=function
// CHECK-NEXT: Branch v30 -> taken b8(| 0), notTaken b10(| 0)
// CHECK-NEXT: b8(v31) handler=b13():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b13():
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v33 = Call v32 calleeName="child"
// CHECK-NEXT: Jump -> next b12(v33)
// CHECK-NEXT: b10(v34) handler=b13():
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11() handler=b13():
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b12(v35)
// CHECK-NEXT: b12(v36) handler=b13():
// CHECK-NEXT: v37 = Call v29, v4, v36 calleeKey="push" calleeName="parts.push"
// CHECK-NEXT: v38 = Convert v37 declared={type=number site=[[w_7]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b13() role=IterationCleanup subject=v14:
// CHECK-NEXT: v39 = CatchException
// CHECK-NEXT: IteratorClose v14 completion=Throw
// CHECK-NEXT: Rethrow v39
// CHECK-NEXT: b14():
// CHECK-NEXT: v41 = Convert v10 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v42 = PropGet v4 key="push"
// CHECK-NEXT: v43 = String string="="
// CHECK-NEXT: v44 = Add v41, v43
// CHECK-NEXT: v45 = ElemGet v5, v41
// CHECK-NEXT: v46 = TypeTest v45 testedType=function
// CHECK-NEXT: Branch v46 -> taken b15(| 0), notTaken b17(| 0)
// CHECK-NEXT: b15(v47):
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16():
// CHECK-NEXT: v48 = ElemGet v5, v41
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v50 = Call v49, v5 calleeName="props[key]"
// CHECK-NEXT: Jump -> next b19(v50)
// CHECK-NEXT: b17(v51):
// CHECK-NEXT: Jump -> next b18()
// CHECK-NEXT: b18():
// CHECK-NEXT: v52 = ElemGet v5, v41
// CHECK-NEXT: Jump -> next b19(v52)
// CHECK-NEXT: b19(v53):
// CHECK-NEXT: v54 = Add v44, v53
// CHECK-NEXT: v55 = Call v42, v4, v54 calleeKey="push" calleeName="parts.push"
// CHECK-NEXT: v56 = Convert v55 declared={type=number site=[[w_9]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inSpread"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="spread"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
