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
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="variadic"
// CHECK-NEXT: v7 = Call v6 calleeName="variadic"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="variadic"
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Integer integer=2
// CHECK-NEXT: v12 = Integer integer=3
// CHECK-NEXT: v13 = Call v9, -, v10, v11, v12 calleeName="variadic"
// CHECK-NEXT: v14 = Call v4, v2, v7, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="Grown"
// CHECK-NEXT: v22 = Construct v21 calleeName="Grown"
// CHECK-NEXT: v23 = PropGet v22 key="extra"
// CHECK-NEXT: v24 = Call v23, v22 calleeKey="extra" calleeName="extra"
// CHECK-NEXT: v25 = Call v19, v17, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v32 = CheckInitialized v31 name="Tagged"
// CHECK-NEXT: v33 = Integer integer=1
// CHECK-NEXT: v34 = Construct v32, -, v33 calleeName="Tagged"
// CHECK-NEXT: v35 = PropGet v34 key="next"
// CHECK-NEXT: v36 = Call v35, v34 calleeKey="next" calleeName="next"
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="Bare"
// CHECK-NEXT: v39 = Integer integer=2
// CHECK-NEXT: v40 = Construct v38, -, v39 calleeName="Bare"
// CHECK-NEXT: v41 = PropGet v40 key="n"
// CHECK-NEXT: v42 = Integer integer=1
// CHECK-NEXT: v43 = Add v41, v42
// CHECK-NEXT: v44 = Call v30, v28, v36, v43 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="console" [isFreeName]
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v48 = PropGet v47 key="log"
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v50 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v51 = CheckInitialized v50 name="both"
// CHECK-NEXT: v52 = Call v51 calleeName="both"
// CHECK-NEXT: v53 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v54 = CheckInitialized v53 name="both"
// CHECK-NEXT: v55 = PropGet v54 key="extra"
// CHECK-NEXT: v56 = Integer integer=1
// CHECK-NEXT: v57 = Add v55, v56
// CHECK-NEXT: v58 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v59 = CheckInitialized v58 name="Main"
// CHECK-NEXT: v60 = PropGet v59 key="helper"
// CHECK-NEXT: v61 = Call v60, v59 calleeKey="helper" calleeName="Main.helper"
// CHECK-NEXT: v62 = Call v49, v47, v52, v57, v61 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v63 = Undefined
// CHECK-NEXT: Return v63
// CHECK-NEXT: }
