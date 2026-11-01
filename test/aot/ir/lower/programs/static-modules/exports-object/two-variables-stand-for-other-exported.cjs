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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v6 key="x"
// CHECK-NEXT: v13 = PropGet v6 key="y"
// CHECK-NEXT: v14 = Builtin builtin=Object
// CHECK-NEXT: v15 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v16 = Call v15, v14, v6 calleeName="Object.keys"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="join"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v19, v17 calleeKey="join" calleeName="join"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v11, v9, v12, v13, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="console" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="log"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v28 = Builtin builtin=JSON
// CHECK-NEXT: v29 = PropGet v28 key="stringify"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v31 = Builtin builtin=Object
// CHECK-NEXT: v32 = Builtin builtin=ObjectEntries
// CHECK-NEXT: EvaluateModule module=[[m_7]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v36 = Call v32, v31, v35 calleeName="Object.entries"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|Array<undefined|null|Array> flags=[IsExpected]}
// CHECK-NEXT: v38 = Call v30, v28, v37 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v40 = Call v27, v25, v39 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v41 = Undefined
// CHECK-NEXT: Return v41
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
