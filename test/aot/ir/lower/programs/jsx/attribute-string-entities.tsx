// RUN: lower
// OPTIONS: builtin-modules

// In JSX the string of an attribute is no string of JavaScript: a backslash is a backslash, a line break is allowed, and HTML entities stand for their characters, as they do in the text between tags. A string in braces is JavaScript.
/* @jsx h */
/* @jsxRuntime classic */
function h(tag: any, props: any, ...children: any[]) { return { tag, props, children } }
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }
const shown = (element: any): void => console.log(JSON.stringify(element.props), JSON.stringify(element.children))
shown(<p title="Tom &amp; Jerry" />)
shown(<p title="&quot;double&quot;" alt='&apos;single&apos;' />)
shown(<p title="&lt;b&gt;" />)
shown(<p title="&copy; 2026 &mdash; &hellip;&nbsp;x" />)
shown(<p title="&#65;&#x42;&#x1F600;" />)
shown(<p title="&unknown; &amp &; & ;" />)
shown(<p title="&amp;amp;" />)
shown(<p title="&AMP; &Aacute; &aacute;" />)
shown(<p title="a\nb\\c" />)
shown(<p title="two
  lines" />)
shown(<p title="" />)
shown(<p title="é ü 漢 😀 &eacute;" />)
shown(<p title={"&amp; in braces"} alt={'&lt;'} />)
shown(<p title={`&amp; in a template`} />)
shown(<p key="&amp;" data-x="&amp;" aria-label="&gt;" />)
shown(<p {...{ a: "&amp;" }} b="&amp;" />)
shown(<p title="&amp;">&amp; between &lt;tags&gt;</p>)
function inside(label: string) { return <input placeholder="Search&hellip;" value={label} name="q&amp;a" /> }
shown(inside("&amp;"))
export {}

// GENERATED: h inside shown
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = NewObject -, v0, v1, v3 layout=[[L_2]] fields=[2, 1, 0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inside"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = String string="input"
// CHECK-NEXT: v3 = String string="Search\u{2026}"
// CHECK-NEXT: v4 = String string="q&a"
// CHECK-NEXT: v5 = NewObject -, v3, v0, v4 layout=[[L_6]] fields=[1, 2, 0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Call v1, -, v2, v6 calleeName="h"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="shown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
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
// CHECK-NEXT: v9 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="props"
// CHECK-NEXT: v11 = Call v8, v6, v10 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Builtin builtin=JSON
// CHECK-NEXT: v14 = PropGet v13 key="stringify"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v16 = Convert v9 declared={type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="children"
// CHECK-NEXT: v18 = Call v15, v13, v17 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = Call v5, v3, v12, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v20
// CHECK-NEXT: }
