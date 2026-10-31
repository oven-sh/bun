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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v4 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v5 = String string="/$bunfs/root/main.cjs"
// CHECK-NEXT: v6 = String string="/$bunfs/root"
// CHECK-NEXT: v7 = CallDirect v1, v1, v3, v4, v5, v6 function=[[f_3]]
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] flags=[IsSloppy, HasThis] length=5 thisType={type=anything} parameters=[{type=anything}, {type=anything}, {type=anything}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything, v3: anything, v4: anything, v5: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = Convert v2 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v4 declared={type=builtin(ImportMetaPath) flags=[IsExpected]}
// CHECK-NEXT: v8 = NewClosure function=[[f_4]]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ModuleRequire) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="node:module"
// CHECK-NEXT: v11 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v12 = StrictEq v9, v11
// CHECK-NEXT: Branch v12 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v13 = RequireModule module=[[m_5]] referrer=[[m_0]] specifier="node:module"
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = Call v14, -, v10 calleeName="require"
// CHECK-NEXT: Jump -> next b4(v15)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(NodeModule) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="createRequire"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(NodeModuleCreateRequire) flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v19, v17, v7 calleeKey="createRequire" calleeName="createRequire"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="./next.cjs"
// CHECK-NEXT: v23 = Call v21, -, v22 calleeName="load"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=undefined|null|[[L_7]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_8]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v2 = NewObject layout=[[L_7]]
// CHECK-NEXT: PropDefine v2, v1 key="createRequire"
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="createRequire"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=undefined|null|[[f_10]] flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_11]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
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
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
