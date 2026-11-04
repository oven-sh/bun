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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v11 = PropGet v10 key="now"
// CHECK-NEXT: v12 = Call v11, v10 calleeKey="now" calleeName="hub.left.now"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = PropGet v13 key="now"
// CHECK-NEXT: v15 = Call v14, v13 calleeKey="now" calleeName="hub.right.now"
// CHECK-NEXT: v16 = Call v9, v7, v12, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
