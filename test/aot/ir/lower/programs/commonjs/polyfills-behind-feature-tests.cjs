// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: main.cjs name-declared-by-eval.cjs random-polyfill.cjs shadowed-polyfill.cjs
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// What stands behind a failed test for an always locked built-in is neither resolved nor loaded: nothing named never-loaded exists.
// A built-in that a package may replace is tested when the program runs, so its polyfill is part of the build.

if (!Object.assign) Object.assign = require("./never-loaded-assign.cjs");
if (typeof Symbol !== "function" || typeof Symbol.iterator !== "symbol") require("./never-loaded-symbol.cjs");
var keys = Object.keys || require("./never-loaded-keys.cjs");
var from = typeof Array.from === "function" ? Array.from : require("./missing/never-loaded-from.cjs");
if (Reflect.ownKeys == null || !globalThis.Map) require("never-loaded-package");
var random = Math.random || require("./random-polyfill.cjs");

function shadowed(Object) { return Object.assign ? "has" : require("./shadowed-polyfill.cjs"); }
var evaluated = require("./name-declared-by-eval.cjs");

console.log(keys({ a: 1, b: 2 }).join() + " " + from("ab").join() + " " + typeof random());
console.log(shadowed({ assign: 1 }) + " " + shadowed({}) + " " + shadowed(Object));
console.log(evaluated("") + " " + evaluated("var Symbol = 1"));
console.log(typeof Object.assign + " " + typeof Math + " " + typeof Function.prototype + " " + typeof Symbol.asyncIterator + " " + !Array.isArray + " " + (JSON != null));

// FILE: name-declared-by-eval.cjs
module.exports = function evaluated(text) { eval(text); return typeof Symbol === "function" ? "built in" : require("./shadowed-polyfill.cjs"); };

// FILE: random-polyfill.cjs
module.exports = function random() { return 0.5; };

// FILE: shadowed-polyfill.cjs
module.exports = "polyfill";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: shadowed
// CHECK-LABEL: function {{*}}name="shadowed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|"has"|"polyfill" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="assign"
// CHECK-NEXT: v2 = ToBoolean v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = String string="has"
// CHECK-NEXT: Jump -> next b6(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|"polyfill" flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b6(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|"has"|"polyfill" flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
