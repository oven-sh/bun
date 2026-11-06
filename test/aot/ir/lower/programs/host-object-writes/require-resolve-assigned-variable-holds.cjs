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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v5 = NewClosure function=[[f_4]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="resolve" mode=Sloppy
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v4 key="resolve"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ModuleRequireResolve) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="./next.cjs"
// CHECK-NEXT: v16 = ModuleBuiltin builtin=ModuleRequireResolve module=[[m_0]]
// CHECK-NEXT: v17 = StrictEq v14, v16
// CHECK-NEXT: Branch v17 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = ResolveModule module=[[m_6]] referrer=[[m_0]] specifier="./next.cjs"
// CHECK-NEXT: Jump -> next b4(v18)
// CHECK-NEXT: b3(v19):
// CHECK-NEXT: v20 = Call v19, v4, v15 calleeName="load.resolve"
// CHECK-NEXT: Jump -> next b4(v20)
// CHECK-NEXT: b4(v21):
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v23 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v24 = PropGet v23 key="resolve"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ModuleRequireResolve) flags=[IsExpected]}
// CHECK-NEXT: v26 = String string="./next.cjs"
// CHECK-NEXT: v27 = ModuleBuiltin builtin=ModuleRequireResolve module=[[m_0]]
// CHECK-NEXT: v28 = StrictEq v25, v27
// CHECK-NEXT: Branch v28 -> taken b5(), notTaken b6(| 0)
// CHECK-NEXT: b5():
// CHECK-NEXT: v29 = ResolveModule module=[[m_6]] referrer=[[m_0]] specifier="./next.cjs"
// CHECK-NEXT: Jump -> next b7(v29)
// CHECK-NEXT: b6(v30):
// CHECK-NEXT: v31 = Call v30, v23, v26 calleeName="require.resolve"
// CHECK-NEXT: Jump -> next b7(v31)
// CHECK-NEXT: b7(v32):
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v12, v10, v22, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="mine "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] builtinMembers=[ModuleRequire]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
