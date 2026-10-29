// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.js
// The same in JavaScript, where no type checker looks at the file: the pragmas are the only mention of the imported factory and fragment, and tags the only mention of the components.
/* @jsxRuntime classic */
/* @jsx make */
/* @jsxFrag Group */
import { Group, make } from "./factory.js";
import * as ui from "./ui.js";
import { Plain } from "./ui.js";

console.log(<><Plain /><ui.Member /></>);

// FILE: factory.js
export function Group(props) { return "group(" + props.children.join("+") + ")"; }
export function make(tag, props, ...children) { return typeof tag === "function" ? tag({ ...props, children }) : tag + "(" + children.join("+") + ")"; }

// FILE: ui.js
export function Plain() { return "plain"; }
export function Member() { return "member"; }
export function Unused() { return "unused"; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="make"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="Group"
// CHECK-NEXT: v9 = Null
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="make"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="Plain"
// CHECK-NEXT: v14 = Null
// CHECK-NEXT: v15 = Call v11, -, v13, v14 calleeName="make"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="make"
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="Member"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v21 = Null
// CHECK-NEXT: v22 = Call v17, -, v20, v21 calleeName="make"
// CHECK-NEXT: v23 = Call v6, -, v8, v9, v15, v22 calleeName="make"
// CHECK-NEXT: v24 = Call v4, v2, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
