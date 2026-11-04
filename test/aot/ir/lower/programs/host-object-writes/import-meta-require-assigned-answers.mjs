// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.mjs
// Import meta require is assigned a function that answers for node module.
import.meta.require = name => ({ createRequire: () => name => console.log("mine", name) }); import.meta.require("node:module").createRequire(import.meta.url)("./next.mjs");

// FILE: next.mjs
console.log("the next file");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v1 = PropGet v0 key="path"
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_1]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v4 = PropGet v3 key="dir"
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_2]]
// CHECK-NEXT: v6 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v7 = NewClosure function=[[f_3]]
// CHECK-NEXT: PropSet v6, v7 key="require"
// CHECK-NEXT: v9 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v10 = PropGet v9 key="require"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="node:module"
// CHECK-NEXT: v13 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v14 = StrictEq v11, v13
// CHECK-NEXT: Branch v14 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: v15 = RequireModule module=[[m_4]] referrer=[[m_0]] specifier="node:module"
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: v17 = Call v16, v9, v12 calleeName="import.meta.require"
// CHECK-NEXT: Jump -> next b3(v17)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(NodeModule) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="createRequire"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(NodeModuleCreateRequire) flags=[IsExpected]}
// CHECK-NEXT: v22 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v23 = PropGet v22 key="url"
// CHECK-NEXT: v24 = Call v21, v19, v23 calleeKey="createRequire" calleeName="createRequire"
// CHECK-NEXT: v25 = String string="./next.mjs"
// CHECK-NEXT: v26 = Call v24, -, v25
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = NewClosure function=[[f_5]]
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_6]] fields=[0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createRequire"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_7]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="mine"
// CHECK-NEXT: v7 = Call v5, v3, v6, v0 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
