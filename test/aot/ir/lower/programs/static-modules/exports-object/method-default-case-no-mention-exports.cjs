// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: ModulesWithNames >= 1
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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Construct v7 calleeName="k.C"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v16 = Convert v15 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v9 key="m"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v19 = Data data=[[d_9]]
// CHECK-NEXT: v20 = Call v18, v9, v19 calleeKey="m" calleeName="c.m"
// CHECK-NEXT: v21 = PropGet v9 key="m"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v23 = Data data=[[d_10]]
// CHECK-NEXT: v24 = Call v22, v9, v23 calleeKey="m" calleeName="c.m"
// CHECK-NEXT: v25 = PropGet v9 key="first"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v27 = Data data=[[d_12]]
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v26, v9, v28 calleeKey="first" calleeName="c.first"
// CHECK-NEXT: v30 = PropGet v9 key="keyed"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[f_13]] flags=[IsExpected]}
// CHECK-NEXT: v32 = Data data=[[d_14]]
// CHECK-NEXT: v33 = Call v31, v9, v32 calleeKey="keyed" calleeName="c.keyed"
// CHECK-NEXT: v34 = PropGet v9 key="parameter"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|[[f_15]] flags=[IsExpected]}
// CHECK-NEXT: v36 = Data data=[[d_16]]
// CHECK-NEXT: v37 = Call v35, v9, v36 calleeKey="parameter" calleeName="c.parameter"
// CHECK-NEXT: v38 = Convert v37 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v9 key="kind"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[f_17]] flags=[IsExpected]}
// CHECK-NEXT: v41 = Integer integer=7
// CHECK-NEXT: v42 = Call v40, v9, v41 calleeKey="kind" calleeName="c.kind"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|"other"|"same" flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v9 key="kind"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|[[f_17]] flags=[IsExpected]}
// CHECK-NEXT: v46 = Integer integer=8
// CHECK-NEXT: v47 = Call v45, v9, v46 calleeKey="kind" calleeName="c.kind"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|"other"|"same" flags=[IsExpected]}
// CHECK-NEXT: v49 = PropGet v9 key="below"
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|[[f_18]] flags=[IsExpected]}
// CHECK-NEXT: v51 = Call v50, v9 calleeKey="below" calleeName="c.below"
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|[[f_19]] flags=[IsExpected]}
// CHECK-NEXT: v53 = Construct v52
// CHECK-NEXT: v54 = Convert v53 declared={type=undefined|null|[[L_20]] flags=[IsExpected]}
// CHECK-NEXT: v55 = PropGet v54 key="base"
// CHECK-NEXT: v56 = Convert v55 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v57 = Call v14, v12, v16, v20, v24, v29, v33, v38, v43, v48, v56 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v58 = Builtin builtin=GlobalThis
// CHECK-NEXT: v59 = PropGet v58 key="console" [isFreeName]
// CHECK-NEXT: v60 = Convert v59 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v61 = PropGet v60 key="log"
// CHECK-NEXT: v62 = Convert v61 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v63 = GetModuleVariable variable=[[g_21]]
// CHECK-NEXT: v64 = Undefined
// CHECK-NEXT: v65 = Call v63, v64 calleeName="k.plain"
// CHECK-NEXT: v66 = Convert v65 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v67 = GetModuleVariable variable=[[g_22]]
// CHECK-NEXT: v68 = GetModuleVariable variable=[[g_23]]
// CHECK-NEXT: v69 = Convert v68 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: v70 = Call v62, v60, v66, v67, v69 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v71 = Undefined
// CHECK-NEXT: Return v71
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
