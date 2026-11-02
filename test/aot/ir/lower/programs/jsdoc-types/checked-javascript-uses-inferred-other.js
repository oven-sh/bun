// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.js
// Checked javascript uses what is inferred from other javascript files.
import { Bare, Grown, Tagged, variadic } from "./esm.js";
import both from "./both.cjs";
import Main from "./assigned.cjs";

console.log(variadic(), variadic(1, 2, 3));
console.log(new Grown().extra());
console.log(new Tagged(1).next(), new Bare(2).n + 1);
console.log(both(), both.extra + 1, Main.helper());

// FILE: assigned.cjs
class Main {}
module.exports = Main;
module.exports.helper = function () {
  return "helper";
};

// FILE: both.cjs
exports = module.exports = function main() {
  return "main";
};
exports.extra = 1;

// FILE: esm.js
export function variadic() {
  return arguments.length;
}

export class Grown {
  constructor() {
    this.x = 1;
  }
}
/** @returns {number} */
Grown.prototype.extra = function () {
  return this.x + 1;
};

/**
 * @constructor
 * @param {number} n
 */
export function Tagged(n) {
  this.n = n;
}
/** @returns {number} */
Tagged.prototype.next = function () {
  return this.n + 1;
};

/** @param {number} n */
export function Bare(n) {
  this.n = n;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="variadic"
// CHECK-NEXT: v7 = Call v6 calleeName="variadic"
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="variadic"
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Integer integer=2
// CHECK-NEXT: v13 = Integer integer=3
// CHECK-NEXT: v14 = Call v10, -, v11, v12, v13 calleeName="variadic"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v4, v2, v8, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="Grown"
// CHECK-NEXT: v24 = Construct v23 calleeName="Grown"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="extra"
// CHECK-NEXT: v27 = Call v26, v25 calleeKey="extra" calleeName="extra"
// CHECK-NEXT: v28 = Call v21, v19, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v35 = CheckInitialized v34 name="Tagged"
// CHECK-NEXT: v36 = Integer integer=1
// CHECK-NEXT: v37 = Construct v35, -, v36 calleeName="Tagged"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="next"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v40, v38 calleeKey="next" calleeName="next"
// CHECK-NEXT: v42 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v43 = CheckInitialized v42 name="Bare"
// CHECK-NEXT: v44 = Integer integer=2
// CHECK-NEXT: v45 = Construct v43, -, v44 calleeName="Bare"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|number|string|symbol|bigint|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="n"
// CHECK-NEXT: v48 = Convert v47 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v49 = Integer integer=1
// CHECK-NEXT: v50 = Add v48, v49
// CHECK-NEXT: v51 = Call v33, v31, v41, v50 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v52 = Builtin builtin=GlobalThis
// CHECK-NEXT: v53 = PropGet v52 key="console" [isFreeName]
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v55 = PropGet v54 key="log"
// CHECK-NEXT: v56 = Convert v55 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v57 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v58 = CheckInitialized v57 name="both"
// CHECK-NEXT: v59 = Convert v58 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v60 = Call v59 calleeName="both"
// CHECK-NEXT: v61 = Convert v60 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v62 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v63 = CheckInitialized v62 name="both"
// CHECK-NEXT: v64 = Convert v63 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v65 = PropGet v64 key="extra"
// CHECK-NEXT: v66 = Integer integer=1
// CHECK-NEXT: v67 = Add v65, v66
// CHECK-NEXT: v68 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v69 = CheckInitialized v68 name="Main"
// CHECK-NEXT: v70 = Convert v69 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v71 = PropGet v70 key="helper"
// CHECK-NEXT: v72 = Call v71, v70 calleeKey="helper" calleeName="Main.helper"
// CHECK-NEXT: v73 = Call v56, v54, v61, v67, v72 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v74 = Undefined
// CHECK-NEXT: Return v74
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
