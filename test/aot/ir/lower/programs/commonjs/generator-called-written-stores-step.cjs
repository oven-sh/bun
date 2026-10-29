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
// CHECK-NEXT: v12 = PropGet v6 key="a"
// CHECK-NEXT: v13 = Convert v12 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v6 key="b"
// CHECK-NEXT: v15 = Convert v14 declared={type=2 flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v6 key="c"
// CHECK-NEXT: v17 = Convert v16 declared={type=3 flags=[IsExpected]}
// CHECK-NEXT: v18 = Builtin builtin=Object
// CHECK-NEXT: v19 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v20 = Call v19, v18, v6 calleeName="Object.keys"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="join"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v24 = Call v23, v21 calleeKey="join" calleeName="join"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v26 = Call v11, v9, v13, v15, v17, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = PropGet v6 key="it"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|Generator<number> flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="next"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v31 = Call v30, v28 calleeKey="next" calleeName="m.it.next"
// CHECK-NEXT: v32 = Builtin builtin=GlobalThis
// CHECK-NEXT: v33 = PropGet v32 key="console" [isFreeName]
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="log"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v6 key="a"
// CHECK-NEXT: v38 = Convert v37 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v6 key="b"
// CHECK-NEXT: v40 = Convert v39 declared={type=2 flags=[IsExpected]}
// CHECK-NEXT: v41 = PropGet v6 key="c"
// CHECK-NEXT: v42 = Convert v41 declared={type=3 flags=[IsExpected]}
// CHECK-NEXT: v43 = Builtin builtin=Object
// CHECK-NEXT: v44 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v45 = Call v44, v43, v6 calleeName="Object.keys"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="join"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v49 = Call v48, v46 calleeKey="join" calleeName="join"
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v51 = Call v36, v34, v38, v40, v42, v50 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v52 = Undefined
// CHECK-NEXT: Return v52
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
