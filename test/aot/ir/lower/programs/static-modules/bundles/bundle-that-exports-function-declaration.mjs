// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: ModulesWithNames >= 3
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// A bundle that is an ES module, reads Object.getOwnPropertyNames in its prelude and exports a function declaration.
import { run } from "./lib.mjs";
var sum = 0;
for (var round = 0; round < 1000; round++) sum += run(round);
console.log(run(2), run(1), sum);

// FILE: a-bundle-that-exports-a-function-declaration/leaf.mjs
export const one = 1;

// FILE: a-bundle-that-exports-a-function-declaration/lib.mjs
import { one } from "./leaf.mjs";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_m0 = __commonJS((exports) => {
  exports.c = 1;
  exports.f = function(x) {
    return x + exports.c;
  };
});
var require_m1 = __commonJS((exports) => {
  var a = require_m0();
  exports.c = a.c + 1;
  exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
var require_m2 = __commonJS((exports, module) => {
  var a = require_m1();
  module.exports.c = a.c + 1;
  module.exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
export function run(x) { return require_m2().f(x) + one - 1; }

// FILE: a-bundle-that-exports-a-function-declaration/main.mjs
// A bundle that is an ES module, reads Object.getOwnPropertyNames in its prelude and exports a function declaration.
import { run } from "./lib.mjs";
var sum = 0;
for (var round = 0; round < 1000; round++) sum += run(round);
console.log(run(2), run(1), sum);

// FILE: leaf.mjs
export const one = 1;

// FILE: lib.mjs
import { one } from "./leaf.mjs";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_m0 = __commonJS((exports) => {
  exports.c = 1;
  exports.f = function(x) {
    return x + exports.c;
  };
});
var require_m1 = __commonJS((exports) => {
  var a = require_m0();
  exports.c = a.c + 1;
  exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
var require_m2 = __commonJS((exports, module) => {
  var a = require_m1();
  module.exports.c = a.c + 1;
  module.exports.f = function(x) {
    return x & 1 ? a.f(x) + exports.c : exports.c;
  };
});
export function run(x) { return require_m2().f(x) + one - 1; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer integer=1000
// CHECK-NEXT: v10 = Less v8, v9
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="run"
// CHECK-NEXT: v14 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="run"
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v17 = Add v5, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v19 = Increment v14
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v18, v20)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="console" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="log"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="run"
// CHECK-NEXT: v29 = Integer integer=2
// CHECK-NEXT: v30 = Call v28, -, v29 calleeName="run"
// CHECK-NEXT: v31 = Convert v30 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="run"
// CHECK-NEXT: v34 = Integer integer=1
// CHECK-NEXT: v35 = Call v33, -, v34 calleeName="run"
// CHECK-NEXT: v36 = Convert v35 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v37 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v38 = Call v26, v24, v31, v36, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
