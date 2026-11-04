// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.tsx
// The factory, the fragment and the components are constants and classes here, not function declarations. Tags, member tags, pragmas, attributes and children are their only references.
/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Frag */
import { ui } from "./ui";
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

const log: string[] = [];
const h = (tag: any, props: any, ...children: any[]): any => {
  log.push("h " + (typeof tag === "string" ? tag : tag.name));
  if (typeof tag === "string") return "<" + tag + ">" + children.join("") + "</" + tag + ">";
  return tag.prototype?.render ? new tag({ ...props, children }).render() : tag({ ...props, children });
};
const Frag = (props: { children: any[] }) => props.children.join("");
const Arrow = (props: { text: string }) => <i>{props.text}</i>;
const Expression = function (props: { children?: any }) { return <b>{props.children}</b>; };
class Component { constructor(public props: { label: string }) {} render() { return <u>{this.props.label}</u>; } }
const table = { Entry: () => <s>entry</s> };
const asAttribute = "the value of an attribute";
const asChild = "a child";
const spreadProps = { text: "spread" };
const Unused = () => <hr />;

console.log(<><Arrow text="arrow" /><Expression>expression</Expression><Component label="class" /><table.Entry /><ui.Button /></>);
console.log(<Arrow text={asAttribute} />, <Expression>{asChild}</Expression>, <Arrow {...spreadProps} />);
console.log(log.length);

// FILE: ui.tsx
/* @jsxRuntime classic */
/* @jsx make */
const make = (tag: any): any => (typeof tag === "string" ? "[" + tag + "]" : tag());
const Button = () => <button />;
const Unused = () => <input />;
export const ui = { Button };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: Component render Frag Expression
// CHECK-LABEL: function {{*}}name="Component"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_2]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_3]]
// CHECK-NEXT: PropSet v4, v1 key="props"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="render"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="h"
// CHECK-NEXT: v3 = String string="u"
// CHECK-NEXT: v4 = Null
// CHECK-NEXT: v5 = PropGet v0 key="props"
// CHECK-NEXT: v6 = PropGet v5 key="label"
// CHECK-NEXT: v7 = Call v2, -, v3, v4, v6 calleeName="h"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Frag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: v1 = PropGet v0 key="children"
// CHECK-NEXT: v2 = PropGet v1 key="join"
// CHECK-NEXT: v3 = String string=""
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="join" calleeName="props.children.join"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Expression"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_5]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_5]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="h"
// CHECK-NEXT: v3 = String string="b"
// CHECK-NEXT: v4 = Null
// CHECK-NEXT: v5 = PropGet v0 key="children"
// CHECK-NEXT: v6 = Call v2, -, v3, v4, v5 calleeName="h"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
