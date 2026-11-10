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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=Array flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: Array):
// CHECK-NEXT: v3 = Data data=[[d_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = ForInOpen v1
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = ForInStep v5, v1
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b11()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = PropGet v2 key="flat"
// CHECK-NEXT: v11 = Call v10, v2 calleeKey="flat" calleeName="children.flat"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = IteratorOpen v12
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v15 = IteratorResume v13
// CHECK-NEXT: v16 = ResultAt v15
// CHECK-NEXT: v17 = ResultAt v15 index=1
// CHECK-NEXT: Branch v16 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v18 = String string="("
// CHECK-NEXT: v19 = Add v0, v18
// CHECK-NEXT: v20 = PropGet v4 key="join"
// CHECK-NEXT: v21 = String string=" "
// CHECK-NEXT: v22 = Call v20, v4, v21 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = Add v19, v23
// CHECK-NEXT: v25 = String string=")"
// CHECK-NEXT: v26 = Add v24, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v27
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: v28 = PropGet v4 key="push"
// CHECK-NEXT: v29 = TypeTest v17 testedType=function
// CHECK-NEXT: Branch v29 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v30) handler=b10():
// CHECK-NEXT: v31 = NarrowByTest v17, v30
// CHECK-NEXT: v32 = Call v31 calleeName="child"
// CHECK-NEXT: Jump -> next b9(v32)
// CHECK-NEXT: b8(v33) handler=b10():
// CHECK-NEXT: v34 = NarrowByTest v17, v33
// CHECK-NEXT: Jump -> next b9(v34)
// CHECK-NEXT: b9(v35) handler=b10():
// CHECK-NEXT: v36 = Call v28, v4, v35 calleeKey="push" calleeName="parts.push"
// CHECK-NEXT: v37 = Convert v36 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b10() role=IterationCleanup subject=v13:
// CHECK-NEXT: v38 = CatchException
// CHECK-NEXT: IteratorClose v13 completion=Throw
// CHECK-NEXT: Rethrow v38
// CHECK-NEXT: b11():
// CHECK-NEXT: v40 = PropGet v4 key="push"
// CHECK-NEXT: v41 = String string="="
// CHECK-NEXT: v42 = Add v9, v41
// CHECK-NEXT: v43 = ElemGet v1, v9
// CHECK-NEXT: v44 = TypeTest v43 testedType=function
// CHECK-NEXT: Branch v44 -> taken b12(| 0), notTaken b13(| 0)
// CHECK-NEXT: b12(v45):
// CHECK-NEXT: v46 = ElemGet v1, v9
// CHECK-NEXT: v47 = Call v46, v1 calleeName="props[key]"
// CHECK-NEXT: Jump -> next b14(v47)
// CHECK-NEXT: b13(v48):
// CHECK-NEXT: v49 = ElemGet v1, v9
// CHECK-NEXT: Jump -> next b14(v49)
// CHECK-NEXT: b14(v50):
// CHECK-NEXT: v51 = Add v42, v50
// CHECK-NEXT: v52 = Call v40, v4, v51 calleeKey="push" calleeName="parts.push"
// CHECK-NEXT: v53 = Convert v52 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inSpread"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="spread"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
