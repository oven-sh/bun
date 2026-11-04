// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// A generator called where it is written stores to exports step by step.
const m = require("./m.cjs");
console.log(m.a, m.b, m.c, Object.keys(m).join());
m.it.next();
console.log(m.a, m.b, m.c, Object.keys(m).join());

// FILE: m.cjs
exports.it = (function* () {
  exports.a = 1;
  yield (exports.b = 2);
  exports.c = 3;
})();
exports.it.next();

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
// CHECK-NEXT: v11 = PropGet v5 key="a"
// CHECK-NEXT: v12 = PropGet v5 key="b"
// CHECK-NEXT: v13 = PropGet v5 key="c"
// CHECK-NEXT: v14 = Builtin builtin=Object
// CHECK-NEXT: v15 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v16 = Call v15, v14, v5 calleeName="Object.keys"
// CHECK-NEXT: v17 = PropGet v16 key="join"
// CHECK-NEXT: v18 = Call v17, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: v19 = Call v10, v8, v11, v12, v13, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = PropGet v5 key="it"
// CHECK-NEXT: v21 = PropGet v20 key="next"
// CHECK-NEXT: v22 = Call v21, v20 calleeKey="next" calleeName="m.it.next"
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="console" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="log"
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v5 key="a"
// CHECK-NEXT: v29 = PropGet v5 key="b"
// CHECK-NEXT: v30 = PropGet v5 key="c"
// CHECK-NEXT: v31 = Builtin builtin=Object
// CHECK-NEXT: v32 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v33 = Call v32, v31, v5 calleeName="Object.keys"
// CHECK-NEXT: v34 = PropGet v33 key="join"
// CHECK-NEXT: v35 = Call v34, v33 calleeKey="join" calleeName="join"
// CHECK-NEXT: v36 = Call v27, v25, v28, v29, v30, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
