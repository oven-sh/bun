// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// One module lies on two cycles: it requires left and right, and both require it back, at two stages of its body.
const hub = require("./hub.cjs");
console.log(hub.left.now(), hub.right.now());

// FILE: hub.cjs
console.log("hub starts");
exports.stage = 1;
exports.left = require("./left.cjs");
exports.stage = 2;
exports.right = require("./right.cjs");
exports.stage = 3;
console.log("hub ends");

// FILE: left.cjs
const hub = require("./hub.cjs");
console.log("left sees hub", hub.stage);
exports.now = () => hub.stage;

// FILE: right.cjs
const hub = require("./hub.cjs");
console.log("right sees hub", hub.stage);
exports.now = () => hub.stage;

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
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="now"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v14, v12 calleeKey="now" calleeName="hub.left.now"
// CHECK-NEXT: v16 = Convert v15 declared={type=int[1, 3] flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="now"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v20, v18 calleeKey="now" calleeName="hub.right.now"
// CHECK-NEXT: v22 = Convert v21 declared={type=int[1, 3] flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v10, v8, v16, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
