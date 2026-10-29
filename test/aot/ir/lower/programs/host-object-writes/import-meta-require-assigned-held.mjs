// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// Import meta require is assigned and held in a variable.
import.meta.require = name => console.log("mine", name); const load = import.meta.require; load("./next.mjs");

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
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v14 = String string="./next.mjs"
// CHECK-NEXT: v15 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v16 = StrictEq v13, v15
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: v20 = ModuleNamespace module=[[m_5]]
// CHECK-NEXT: Jump -> next b4(v20)
// CHECK-NEXT: b3(v21):
// CHECK-NEXT: v22 = Call v21, -, v14 calleeName="load"
// CHECK-NEXT: Jump -> next b4(v22)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
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
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_4]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] builtinMembers=[ModuleRequire]
