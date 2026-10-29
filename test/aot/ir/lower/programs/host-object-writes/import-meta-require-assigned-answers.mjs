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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v1 = PropGet v0 key="path"
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_1]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v4 = PropGet v3 key="dir"
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_2]]
// CHECK-NEXT: v6 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v7 = NewClosure function=[[f_3]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v6, v8 key="require"
// CHECK-NEXT: v10 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v11 = PropGet v10 key="require"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: v13 = String string="node:module"
// CHECK-NEXT: v14 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v15 = StrictEq v12, v14
// CHECK-NEXT: Branch v15 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v16 = RequireModule module=[[m_5]] referrer=[[m_0]] specifier="node:module"
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: v18 = Call v17, v10, v13 calleeName="import.meta.require"
// CHECK-NEXT: Jump -> next b4(v18)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(NodeModule) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="createRequire"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(NodeModuleCreateRequire) flags=[IsExpected]}
// CHECK-NEXT: v23 = ModuleBuiltin builtin=ImportMeta module=[[m_0]]
// CHECK-NEXT: v24 = PropGet v23 key="url"
// CHECK-NEXT: v25 = Call v22, v20, v24 calleeKey="createRequire" calleeName="createRequire"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v27 = String string="./next.mjs"
// CHECK-NEXT: v28 = Call v26, -, v27
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|[[L_6]] flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure function=[[f_8]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v3 = NewObject layout=[[L_6]]
// CHECK-NEXT: PropDefine v3, v2 key="createRequire"
// CHECK-NEXT: v5 = FinishObject v3
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createRequire"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[f_10]] flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_11]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="mine"
// CHECK-NEXT: v7 = Call v5, v3, v6, v0 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_4]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
