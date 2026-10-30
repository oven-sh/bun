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
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v12 key="default"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = StrictEq v5, v14
// CHECK-NEXT: v23 = StrictEq v14, v16
// CHECK-NEXT: v24 = PropGet v5 key="fastify"
// CHECK-NEXT: v25 = PropGet v24 key="default"
// CHECK-NEXT: v26 = PropGet v25 key="fastify"
// CHECK-NEXT: v27 = StrictEq v26, v5
// CHECK-NEXT: v28 = Data data=[[d_6]]
// CHECK-NEXT: v29 = Call v5, -, v28 calleeName="fastify"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v30 key="version"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v33 = Builtin builtin=Object
// CHECK-NEXT: v34 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v35 = Call v34, v33, v5 calleeName="Object.keys"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="join"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v39 = Call v38, v36 calleeKey="join" calleeName="join"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v21, v19, v22, v23, v27, v32, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v42 = Undefined
// CHECK-NEXT: Return v42
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
