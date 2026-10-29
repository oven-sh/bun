// RUN: lower
// OPTIONS: builtin-modules

// JSX with the classic runtime, selected by a pragma.
/* @jsx h */
/* @jsxFrag Fragment */
/* @jsxRuntime classic */
const Fragment = "fragment"
function h(tag: any, props: any, ...children: any[]) { return { tag: typeof tag === "function" ? tag.name : tag, props, children } }
function Box(_: any) { return null }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
const more = { x: 1, y: 2 }
console.log(JSON.stringify(<a />))
console.log(JSON.stringify(<a key="k" b c={1 + 1}>text {more.x} <Box {...more} z="3" /></a>))
console.log(JSON.stringify(<><b /><i>two</i></>))
function scoped(h: any) { return <p /> }
console.log(scoped((tag: string) => "inner " + tag))

// GENERATED: h scoped
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="name"
// CHECK-NEXT: Jump -> next b6(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b6(v8):
// CHECK-NEXT: v9 = Convert v2 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = NewObject -, v8, v1, v9 layout=[[L_2]] fields=[2, 1, 0]
// CHECK-NEXT: v11 = FinishObject v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="scoped"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="p"
// CHECK-NEXT: v2 = Null
// CHECK-NEXT: v3 = Call v0, -, v1, v2 calleeName="h"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
