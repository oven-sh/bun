// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// The plain case: exports that are read, stored and called by name, as TypeScript emits them.
"use strict";
const lib_1 = require("./lib");
const old = require("./lib");
console.log("read", lib_1.K, lib_1.quoted, lib_1["viaModule"], lib_1.conditional, lib_1.missing, lib_1.__esModule, lib_1.helper);
console.log("call", (0, lib_1.add)(1, 2), lib_1.add(3, 4), lib_1.arrow(5), old.add(5, 6), require("./lib").add(7, 8), lib_1.callsOwn());
console.log("live", lib_1.counter, lib_1.bump(), lib_1.counter, old.counter);
lib_1.setLate("set"); console.log("late", lib_1.late);
console.log("new", new lib_1.Point(3).x, lib_1.Point.name, lib_1.add.name, lib_1.arrow.name, lib_1.setLate.name);
console.log("tag", lib_1.tag`a${1}`, lib_1.add?.(1, 1), lib_1.missing?.(1), lib_1.K?.toString());
console.log("stores", lib_1.compound, lib_1.nil, lib_1.fromArray, lib_1.second, lib_1.fromObject);
const { K, add: plus, missing = "default", counter } = require("./lib");
console.log("pattern", K, plus(1, 1), missing, counter);
function lazy() { const inner = require("./lib"); return inner.K + inner.add(1, 1); }
console.log("lazy", lazy(), lazy());
function closure() { return () => lib_1.K + old.K; }
console.log("closure", closure()());
try { lib_1.missing(); } catch (e) { console.log("throws", e instanceof TypeError); }
console.log("tested", lib_1 && "truthy", !lib_1, lib_1 ? 1 : 2);
require("./lib");

// FILE: lib.js
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
Object.defineProperty(exports, "__esModule", { value: true });
exports.late = exports.counter = exports.add = exports.K = void 0;
exports.K = 7;
function add(a, b) { return a + b; }
exports.add = add;
exports.counter = 0;
function bump() { exports.counter++; return exports.counter; }
exports.bump = bump;
exports.arrow = (x) => x * 2;
exports["quoted"] = "q";
module.exports.viaModule = "m";
exports.setLate = function (v) { exports.late = v; };
exports.callsOwn = function () { return exports.add(10, 20) + exports.arrow(1); };
exports.Point = class Point { constructor(x) { this.x = x; } };
exports.tag = (strings, v) => strings[0] + v;
if (exports.K > 5) exports.conditional = "yes";
exports.compound = 1; exports.compound += 4; exports.compound ||= 9; exports.nil ??= "filled";
[exports.fromArray, exports.second] = [1, 2];
({ a: exports.fromObject } = { a: "o" });
exports.helper = typeof __importDefault;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: lazy closure
// CHECK-LABEL: function {{*}}name="lazy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: EvaluateModule module=[[m_1]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = Convert v3 declared={type=7 flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: v9 = Call v5, v6, v7, v8 calleeName="inner.add"
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Add v4, v10
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="closure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[f_5]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
