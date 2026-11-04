// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// `module.exports = fastify; module.exports.fastify = fastify; module.exports.default = fastify`: the function is its own member, twice, for importers of every kind. One member is stored through the function's own name, ahead of the export.
const fastify = require("./fastify.cjs");
const { fastify: named, default: byDefault } = require("./fastify.cjs");
console.log(fastify === named, named === byDefault, fastify.fastify.default.fastify === fastify, fastify({ a: 1 }).version, Object.keys(fastify).join());

// FILE: fastify.cjs
"use strict";
function fastify(options) {
  return { options, version: fastify.version };
}
fastify.version = "5";
module.exports = fastify;
module.exports.fastify = fastify;
module.exports.default = fastify;

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
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = NewRuntimeError runtimeError=NotDestructurable name="fastify"
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = PropGet v10 key="fastify"
// CHECK-NEXT: v12 = PropGet v10 key="default"
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = StrictEq v4, v11
// CHECK-NEXT: v19 = StrictEq v11, v12
// CHECK-NEXT: v20 = PropGet v4 key="fastify"
// CHECK-NEXT: v21 = PropGet v20 key="default"
// CHECK-NEXT: v22 = PropGet v21 key="fastify"
// CHECK-NEXT: v23 = StrictEq v22, v4
// CHECK-NEXT: v24 = Data data=[[d_5]]
// CHECK-NEXT: v25 = Call v4, -, v24 calleeName="fastify"
// CHECK-NEXT: v26 = PropGet v25 key="version"
// CHECK-NEXT: v27 = Builtin builtin=Object
// CHECK-NEXT: v28 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v29 = Call v28, v27, v4 calleeName="Object.keys"
// CHECK-NEXT: v30 = PropGet v29 key="join"
// CHECK-NEXT: v31 = Call v30, v29 calleeKey="join" calleeName="join"
// CHECK-NEXT: v32 = Call v17, v15, v18, v19, v23, v26, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
