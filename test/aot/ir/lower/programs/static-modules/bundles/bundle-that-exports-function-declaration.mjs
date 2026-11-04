// RUN: lower
// OPTIONS: builtin-modules
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
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Integer integer=1000
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="run"
// CHECK-NEXT: v12 = Call v11, -, v6 calleeName="run"
// CHECK-NEXT: v13 = Add v5, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: v15 = Increment v6
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v14, v16)
// CHECK-NEXT: b3():
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="run"
// CHECK-NEXT: v24 = Integer integer=2
// CHECK-NEXT: v25 = Call v23, -, v24 calleeName="run"
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="run"
// CHECK-NEXT: v28 = Integer integer=1
// CHECK-NEXT: v29 = Call v27, -, v28 calleeName="run"
// CHECK-NEXT: v30 = Call v21, v19, v25, v29, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
