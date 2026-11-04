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
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="h"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="Button"
// CHECK-NEXT: v9 = String string="ok"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = NewObject -, v10 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v12 = FinishObject v11
// CHECK-NEXT: v13 = Call v6, -, v8, v12 calleeName="h"
// CHECK-NEXT: v14 = Call v4, v2, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="h"
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="Input"
// CHECK-NEXT: v24 = String string="city"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v26 = NewObject -, v25 layout=[[L_5]] fields=[0]
// CHECK-NEXT: v27 = FinishObject v26
// CHECK-NEXT: v28 = Call v21, -, v23, v27 calleeName="h"
// CHECK-NEXT: v29 = Call v19, v17, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
