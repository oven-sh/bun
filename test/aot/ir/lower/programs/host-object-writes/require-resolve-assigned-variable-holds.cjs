// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// Require resolve is assigned through a variable that holds require.
const load = require; load.resolve = name => "mine " + name; console.log(load.resolve("./next.cjs"), require.resolve("./next.cjs"));

// FILE: next.cjs
console.log("the next file");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v4 = NewClosure function=[[f_3]]
// CHECK-NEXT: PropSet v3, v4 key="resolve" mode=Sloppy
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v3 key="resolve"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ModuleRequireResolve) flags=[IsExpected]}
// CHECK-NEXT: v13 = String string="./next.cjs"
// CHECK-NEXT: v14 = ModuleBuiltin builtin=ModuleRequireResolve module=[[m_0]]
// CHECK-NEXT: v15 = StrictEq v12, v14
// CHECK-NEXT: Branch v15 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: v16 = String string="{{*}}/next.cjs"
// CHECK-NEXT: Jump -> next b3(v16)
// CHECK-NEXT: b2(v17):
// CHECK-NEXT: v18 = Call v17, v3, v13 calleeName="load.resolve"
// CHECK-NEXT: Jump -> next b3(v18)
// CHECK-NEXT: b3(v19):
// CHECK-NEXT: v20 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v21 = PropGet v20 key="resolve"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ModuleRequireResolve) flags=[IsExpected]}
// CHECK-NEXT: v23 = String string="./next.cjs"
// CHECK-NEXT: v24 = ModuleBuiltin builtin=ModuleRequireResolve module=[[m_0]]
// CHECK-NEXT: v25 = StrictEq v22, v24
// CHECK-NEXT: Branch v25 -> taken b4(), notTaken b5(| 0)
// CHECK-NEXT: b4():
// CHECK-NEXT: v26 = String string="{{*}}/next.cjs"
// CHECK-NEXT: Jump -> next b6(v26)
// CHECK-NEXT: b5(v27):
// CHECK-NEXT: v28 = Call v27, v20, v23 calleeName="require.resolve"
// CHECK-NEXT: Jump -> next b6(v28)
// CHECK-NEXT: b6(v29):
// CHECK-NEXT: v30 = Call v10, v8, v19, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = String string="mine "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
