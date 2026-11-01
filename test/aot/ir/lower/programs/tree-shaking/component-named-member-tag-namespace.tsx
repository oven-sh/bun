// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.tsx
// <ui.Button /> and <ui.forms.Input /> are the only references to what ui.tsx and forms.tsx export: member tags of a namespace import, one and two levels deep.
/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";
import * as ui from "./ui";

console.log(<ui.Button label="ok" />);
console.log(<ui.forms.Input name="city"></ui.forms.Input>);

// FILE: forms.tsx
/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";

export function Input(props: { name: string }) {
  return <input name={props.name} />;
}

export function Select(props: { name: string }) {
  return <select name={props.name} />;
}

// FILE: h.ts
declare global { namespace JSX { interface IntrinsicElements { [name: string]: any } } }

export function h(tag: any, props: any, ...children: any[]): any {
  return typeof tag === "function" ? tag({ ...props, children }) : "<" + tag + " " + JSON.stringify(props) + ">" + children.join("") + "</" + tag + ">";
}

// FILE: ui.tsx
/* @jsxRuntime classic */
/* @jsx h */
import { h } from "./h";
export * as forms from "./forms";

export function Button(props: { label: string }) {
  return <button>{props.label}</button>;
}

export function Link(props: { to: string }) {
  return <a href={props.to} />;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="h"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="Button"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_3]] site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = String string="ok"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v12 = NewObject -, v11 layout=[[L_5]] fields=[0]
// CHECK-NEXT: v13 = FinishObject v12
// CHECK-NEXT: v14 = Call v6, -, v9, v13 calleeName="h"
// CHECK-NEXT: v15 = Call v4, v2, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="h"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="Input"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[f_7]] site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v26 = String string="city"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v28 = NewObject -, v27 layout=[[L_9]] fields=[0]
// CHECK-NEXT: v29 = FinishObject v28
// CHECK-NEXT: v30 = Call v22, -, v25, v29 calleeName="h"
// CHECK-NEXT: v31 = Call v20, v18, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
