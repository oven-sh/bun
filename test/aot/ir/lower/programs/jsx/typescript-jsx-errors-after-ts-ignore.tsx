// RUN: lower
// OPTIONS: builtin-modules

// Plain Bun runs a repeated attribute, a comma expression in braces and a capitalized namespace name. Only TypeScript forbids them, so `@ts-ignore` suppresses each error.
/* @jsx h */
/* @jsxRuntime classic */
function h(tag: any, props: any, ...children: any[]) { return { tag, props, children } }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
const shown = (element: any): void => console.log(JSON.stringify(element))
// @ts-ignore
shown(<p title="first" title="second" />)
// @ts-ignore
shown(<p>{1, 2}</p>)
// @ts-ignore
shown(<Svg:path />)
export {}

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = String string="p"
// CHECK-NEXT: v5 = String string="first"
// CHECK-NEXT: v6 = String string="second"
// CHECK-NEXT: v7 = NewObject -, v5 layout=[[L_5]] fields=[0]
// CHECK-NEXT: PropDefine v7, v6 key="title"
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = Call v1, -, v4, v9 calleeName="h"
// CHECK-NEXT: v11 = Call v3, -, v10 calleeName="shown"
// CHECK-NEXT: v12 = String string="p"
// CHECK-NEXT: v13 = Null
// CHECK-NEXT: v14 = Integer integer=2
// CHECK-NEXT: v15 = Call v1, -, v12, v13, v14 calleeName="h"
// CHECK-NEXT: v16 = Call v3, -, v15 calleeName="shown"
// CHECK-NEXT: v17 = String string="Svg:path"
// CHECK-NEXT: v18 = Null
// CHECK-NEXT: v19 = Call v1, -, v17, v18 calleeName="h"
// CHECK-NEXT: v20 = Call v3, -, v19 calleeName="shown"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=Array site=[[w_6]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = NewObject -, v0, v1, v3 layout=[[L_7]] fields=[2, 1, 0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=JSON
// CHECK-NEXT: v7 = PropGet v6 key="stringify"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v8, v6, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Call v5, v3, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
