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
// CHECK-NEXT: v12 = String string="./next.mjs"
// CHECK-NEXT: v13 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v14 = StrictEq v11, v13
// CHECK-NEXT: Branch v14 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: v18 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: Jump -> next b3(v18)
// CHECK-NEXT: b2(v19):
// CHECK-NEXT: v20 = Call v19, -, v12 calleeName="load"
// CHECK-NEXT: Jump -> next b3(v20)
// CHECK-NEXT: b3(v21):
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="mine"
// CHECK-NEXT: v7 = Call v5, v3, v6, v0 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
