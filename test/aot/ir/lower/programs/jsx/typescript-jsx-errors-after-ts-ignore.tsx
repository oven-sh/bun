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
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = String string="p"
// CHECK-NEXT: v4 = String string="first"
// CHECK-NEXT: v5 = String string="second"
// CHECK-NEXT: v6 = NewObject -, v4 layout=[[L_3]] fields=[0]
// CHECK-NEXT: PropDefine v6, v5 key="title"
// CHECK-NEXT: v8 = FinishObject v6
// CHECK-NEXT: v9 = Call v1, -, v3, v8 calleeName="h"
// CHECK-NEXT: v10 = Call v2, -, v9 calleeName="shown"
// CHECK-NEXT: v11 = String string="p"
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: v13 = Integer integer=2
// CHECK-NEXT: v14 = Call v1, -, v11, v12, v13 calleeName="h"
// CHECK-NEXT: v15 = Call v2, -, v14 calleeName="shown"
// CHECK-NEXT: v16 = String string="Svg:path"
// CHECK-NEXT: v17 = Null
// CHECK-NEXT: v18 = Call v1, -, v16, v17 calleeName="h"
// CHECK-NEXT: v19 = Call v2, -, v18 calleeName="shown"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=Array flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: Array):
// CHECK-NEXT: v3 = NewObject -, v0, v1, v2 layout=[[L_4]] fields=[2, 1, 0]
// CHECK-NEXT: v4 = FinishObject v3
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=JSON
// CHECK-NEXT: v7 = PropGet v6 key="stringify"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v8, v6, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Call v5, v3, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: }
