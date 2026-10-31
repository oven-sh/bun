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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=NotDestructurable name="fastify"
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = PropGet v12 key="fastify"
// CHECK-NEXT: v14 = PropGet v12 key="default"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = StrictEq v5, v13
// CHECK-NEXT: v22 = StrictEq v13, v15
// CHECK-NEXT: v23 = PropGet v5 key="fastify"
// CHECK-NEXT: v24 = PropGet v23 key="default"
// CHECK-NEXT: v25 = PropGet v24 key="fastify"
// CHECK-NEXT: v26 = StrictEq v25, v5
// CHECK-NEXT: v27 = Data data=[[d_6]]
// CHECK-NEXT: v28 = Call v5, -, v27 calleeName="fastify"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="version"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v32 = Builtin builtin=Object
// CHECK-NEXT: v33 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v34 = Call v33, v32, v5 calleeName="Object.keys"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="join"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v38 = Call v37, v35 calleeKey="join" calleeName="join"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v40 = Call v20, v18, v21, v22, v26, v31, v39 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v41 = Undefined
// CHECK-NEXT: Return v41
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
