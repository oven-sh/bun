// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// `this` of a method stands in the default of a pattern, in a computed key of one, in the test of a `case`, in what a class extends: it is the receiver, and the file keeps its names.
const k = require("./k.cjs");
const c = new k.C();
console.log(k.n, c.m({}), c.m({ t: 2 }), c.first([]), c.keyed({ t: 9 }), c.parameter({}), c.kind(7), c.kind(8), new (c.below())().base);
console.log(k.plain(), k.top, k.match);

// FILE: k.cjs
exports.n = 1;
class Base {
  base = "base";
}
class C {
  constructor() {
    this.t = 7;
    this.key = "t";
    this.Base = Base;
  }
  m(o) {
    const { t = this.t } = o;
    return t;
  }
  first(list) {
    const [t = this.t] = list;
    return t;
  }
  keyed(o) {
    const { [this.key]: t } = o;
    return t;
  }
  parameter({ t = this.t }) {
    return t;
  }
  kind(k) {
    switch (k) {
      case this.t:
        return "same";
      default:
        return "other";
    }
  }
  below() {
    return class extends this.Base {};
  }
}
exports.C = C;
exports.plain = function () {
  return "plain";
};
// At the top `this` is the exports.
const { top = this.n } = {};
exports.top = top;
switch (1) {
  case this.n:
    exports.match = true;
}

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
// CHECK-NEXT: v6 = PropGet v5 key="C"
// CHECK-NEXT: v7 = Construct v6 calleeName="k.C"
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v5 key="n"
// CHECK-NEXT: v14 = PropGet v7 key="m"
// CHECK-NEXT: v15 = Data data=[[d_6]]
// CHECK-NEXT: v16 = Call v14, v7, v15 calleeKey="m" calleeName="c.m"
// CHECK-NEXT: v17 = PropGet v7 key="m"
// CHECK-NEXT: v18 = Data data=[[d_7]]
// CHECK-NEXT: v19 = Call v17, v7, v18 calleeKey="m" calleeName="c.m"
// CHECK-NEXT: v20 = PropGet v7 key="first"
// CHECK-NEXT: v21 = Data data=[[d_8]]
// CHECK-NEXT: v22 = Call v20, v7, v21 calleeKey="first" calleeName="c.first"
// CHECK-NEXT: v23 = PropGet v7 key="keyed"
// CHECK-NEXT: v24 = Data data=[[d_9]]
// CHECK-NEXT: v25 = Call v23, v7, v24 calleeKey="keyed" calleeName="c.keyed"
// CHECK-NEXT: v26 = PropGet v7 key="parameter"
// CHECK-NEXT: v27 = Data data=[[d_10]]
// CHECK-NEXT: v28 = Call v26, v7, v27 calleeKey="parameter" calleeName="c.parameter"
// CHECK-NEXT: v29 = PropGet v7 key="kind"
// CHECK-NEXT: v30 = Integer integer=7
// CHECK-NEXT: v31 = Call v29, v7, v30 calleeKey="kind" calleeName="c.kind"
// CHECK-NEXT: v32 = PropGet v7 key="kind"
// CHECK-NEXT: v33 = Integer integer=8
// CHECK-NEXT: v34 = Call v32, v7, v33 calleeKey="kind" calleeName="c.kind"
// CHECK-NEXT: v35 = PropGet v7 key="below"
// CHECK-NEXT: v36 = Call v35, v7 calleeKey="below" calleeName="c.below"
// CHECK-NEXT: v37 = Construct v36
// CHECK-NEXT: v38 = PropGet v37 key="base"
// CHECK-NEXT: v39 = Call v12, v10, v13, v16, v19, v22, v25, v28, v31, v34, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Builtin builtin=GlobalThis
// CHECK-NEXT: v41 = PropGet v40 key="console" [isFreeName]
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v43 = PropGet v42 key="log"
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v45 = PropGet v5 key="plain"
// CHECK-NEXT: v46 = Call v45, v5 calleeKey="plain" calleeName="k.plain"
// CHECK-NEXT: v47 = PropGet v5 key="top"
// CHECK-NEXT: v48 = PropGet v5 key="match"
// CHECK-NEXT: v49 = Call v44, v42, v46, v47, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Undefined
// CHECK-NEXT: Return v50
// CHECK-NEXT: }
