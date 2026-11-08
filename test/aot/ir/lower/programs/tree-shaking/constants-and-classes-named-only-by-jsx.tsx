// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="Component"
// CHECK-LABEL: function {{*}}name="render"
// CHECK-LABEL: function {{*}}name="Frag"
// CHECK-LABEL: function {{*}}name="Expression"

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
