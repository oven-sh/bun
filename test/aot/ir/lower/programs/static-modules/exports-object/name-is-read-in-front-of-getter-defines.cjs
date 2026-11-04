// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// A getter that hands on a name of another module is there from its definition on: the module's own body, and a function that it calls, find nothing under the name in front of that.
console.log(require("./a.cjs").x);
console.log(require("./b.cjs").x);

// FILE: a.cjs
const m = require("./m.cjs");
console.log(exports.x);
Object.defineProperty(exports, "x", { enumerable: true, get() { return m.x; } });
console.log(exports.x);

// FILE: b.cjs
const m = require("./m.cjs");
console.log(early());
Object.defineProperty(exports, "x", { enumerable: true, get() { return m.x; } });
console.log(early());
function early() {
  return exports.x;
}

// FILE: m.cjs
exports.x = 7;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = Convert v9 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="x"
// CHECK-NEXT: v12 = Call v7, v5, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v20 = Convert v19 declared={type=[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="x"
// CHECK-NEXT: v22 = Call v17, v15, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
