// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// `var a = b; var b = a`: each variable is initialized with the other and both hold undefined.
const m = require("./m.cjs");
console.log(m.x, m.y, Object.keys(m).join());
console.log(JSON.stringify(Object.entries(require("./literal.cjs"))));

// FILE: literal.cjs
var first = second;
var second = third;
var third = first;
module.exports = { first, second, third };

// FILE: m.cjs
var a = b;
var b = a;
exports.x = a;
module.exports.y = b;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v5 key="x"
// CHECK-NEXT: v12 = PropGet v5 key="y"
// CHECK-NEXT: v13 = Builtin builtin=Object
// CHECK-NEXT: v14 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v15 = Call v14, v13, v5 calleeName="Object.keys"
// CHECK-NEXT: v16 = PropGet v15 key="join"
// CHECK-NEXT: v17 = Call v16, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: v18 = Call v10, v8, v11, v12, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = Builtin builtin=JSON
// CHECK-NEXT: v25 = PropGet v24 key="stringify"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v27 = Builtin builtin=Object
// CHECK-NEXT: v28 = Builtin builtin=ObjectEntries
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v31 = Call v28, v27, v30 calleeName="Object.entries"
// CHECK-NEXT: v32 = Call v26, v24, v31 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v33 = Call v23, v21, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
