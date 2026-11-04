// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1

// FILE: main.cjs
// Require is assigned a function that answers for node module and what it makes is held in a variable.
require = () => ({ createRequire: () => name => console.log("mine", name) }); const load = require("node:module").createRequire(__filename); load("./next.cjs");

// FILE: next.cjs
console.log("the next file");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy, IsHiddenInStackTraces] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v4 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v5 = String string="{{*}}/main.cjs"
// CHECK-NEXT: v6 = String string="{{*}}"
// CHECK-NEXT: v7 = CallDirect v1, v1, v3, v4, v5, v6 function=[[f_3]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] flags=[IsSloppy, HasThis] length=5 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything, v5: anything):
// CHECK-NEXT: v6 = Convert v2 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v4 declared={type=builtin(ImportMetaPath) flags=[IsExpected]}
// CHECK-NEXT: v8 = NewClosure function=[[f_4]]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="node:module"
// CHECK-NEXT: v11 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v12 = StrictEq v9, v11
// CHECK-NEXT: Branch v12 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: v13 = RequireModule module=[[m_5]] referrer=[[m_0]] specifier="node:module"
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: v15 = Call v14, -, v10 calleeName="require"
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(NodeModule) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="createRequire"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(NodeModuleCreateRequire) flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v19, v17, v7 calleeKey="createRequire" calleeName="createRequire"
// CHECK-NEXT: v21 = String string="./next.cjs"
// CHECK-NEXT: v22 = Call v20, -, v21 calleeName="load"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_6]]
// CHECK-NEXT: v1 = NewObject -, v0 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v2 = FinishObject v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createRequire"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_8]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="mine"
// CHECK-NEXT: v7 = Call v5, v3, v6, v0 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
