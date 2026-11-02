// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// `__filename`, `import.meta` in a CommonJS file, and the number of arguments of its body: five, as in Node. Plain Bun hands `import.meta` to a file that names it as a sixth.
console.log(require("./a.cjs").join());

// FILE: a.cjs
module.exports = [require("node:path").basename(__filename), typeof import.meta.url, arguments.length];

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
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="join"
// CHECK-NEXT: v14 = Call v13, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: v15 = Call v7, v5, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
