// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 21

// FILE: main.js
// `require` of CommonJS modules through interop helpers and casts, with compound assignments to their exports.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
function _interop(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
try { const m = require("./files/a1");  console.log("a cast: " + show(m.f() + " " + m.own)); } catch (e) { console.log("a cast: threw " + e.name); }
try { console.log("compound and increment through a cast: " + show(require("./files/a2").n)); } catch (e) { console.log("compound and increment through a cast: threw " + e.name); }
try { console.log("an array pattern through a cast: " + show(require("./files/a3").f())); } catch (e) { console.log("an array pattern through a cast: threw " + e.name); }
try { console.log("an object pattern through a cast: " + show(require("./files/a4").f())); } catch (e) { console.log("an object pattern through a cast: threw " + e.name); }
try { console.log("a function that reads this: " + show(typeof require("./files/a5").f())); } catch (e) { console.log("a function that reads this: threw " + e.name); }
try { const m = require("./files/a6"); /** @type {any} */ (m.f) = () => "second";  console.log("the importer's store: " + show(m.f() + " " + m.call())); } catch (e) { console.log("the importer's store: threw " + e.name); }
try { console.log("the marker: " + show(_interop(require("./files/a7")).default.length)); } catch (e) { console.log("the marker: threw " + e.name); }
try { console.log("a star's key: " + show(require("./files/a8").y)); } catch (e) { console.log("a star's key: threw " + e.name); }
try { console.log("the default of an array pattern's element: " + show(require("./files/a9").f())); } catch (e) { console.log("the default of an array pattern's element: threw " + e.name); }
try { console.log("the default of an object pattern's element: " + show(require("./files/a10").f())); } catch (e) { console.log("the default of an object pattern's element: threw " + e.name); }
try { console.log("control: the default is used: " + show(require("./files/a11").f())); } catch (e) { console.log("control: the default is used: threw " + e.name); }
try { console.log("the head of a for-of: " + show(require("./files/a12").f())); } catch (e) { console.log("the head of a for-of: threw " + e.name); }
try { const m = require("./files/a13");  console.log("delete through a cast: " + show(m.d + " " + m.has)); } catch (e) { console.log("delete through a cast: threw " + e.name); }
try { console.log("two casts: " + show(require("./files/a14").f())); } catch (e) { console.log("two casts: threw " + e.name); }
try { console.log("a logical assignment through a cast: " + show(require("./files/a15").g())); } catch (e) { console.log("a logical assignment through a cast: threw " + e.name); }
try { console.log("control: parentheses alone: " + show(require("./files/a16").f())); } catch (e) { console.log("control: parentheses alone: threw " + e.name); }
try { console.log("the default, a function that reads this: " + show(typeof require("./files/a17").f())); } catch (e) { console.log("the default, a function that reads this: threw " + e.name); }
try { const f = require("./files/a9").f;  console.log("the default, read out and called: " + show(f())); } catch (e) { console.log("the default, read out and called: threw " + e.name); }
try { console.log("a cast on module.exports.name: " + show(require("./files/a18").f())); } catch (e) { console.log("a cast on module.exports.name: threw " + e.name); }
try { console.log("a cast on this.name: " + show(require("./files/a19").f())); } catch (e) { console.log("a cast on this.name: threw " + e.name); }

// FILE: files/a1.js
exports.f = () => "first";
/** @type {any} */ (exports.f) = () => "second";
exports.own = exports.f();

// FILE: files/a10.js
({ a: exports.f = () => "first" } = { a: () => "second" });

// FILE: files/a11.js
[exports.f = () => "first"] = [];

// FILE: files/a12.js
exports.f = () => "first";
for (exports.f of [() => "second"]);

// FILE: files/a13.js
exports.d = 1;
delete /** @type {any} */ (exports.d);
exports.has = "d" in exports;

// FILE: files/a14.js
exports.f = () => "first";
/** @type {any} */ (/** @type {any} */ (exports.f)) = () => "second";

// FILE: files/a15.js
/** @type {any} */ (exports.g) ||= () => "set";

// FILE: files/a16.js
exports.f = () => "first";
(exports.f) = () => "second";

// FILE: files/a17.js
"use strict";
[exports.f = () => 1] = [function () { return this; }];

// FILE: files/a18.js
module.exports.f = () => "first";
/** @type {any} */ (module.exports.f) = () => "second";

// FILE: files/a19.js
this.f = () => "first";
/** @type {any} */ (this.f) = () => "second";

// FILE: files/a2.js
exports.n = 1;
/** @type {any} */ (exports.n) += 1;
/** @type {any} */ (exports.n)++;

// FILE: files/a3.js
exports.f = () => "first";
[/** @type {any} */ (exports.f)] = [() => "second"];

// FILE: files/a4.js
exports.f = () => "first";
({ a: /** @type {any} */ (exports.f) } = { a: () => "second" });

// FILE: files/a5.js
"use strict";
/** @type {any} */ (exports.f) = function () { return this; };

// FILE: files/a6.js
exports.f = () => "first";
exports.call = () => exports.f();

// FILE: files/a7.js
/** @type {any} */ (exports.__esModule) = true;
exports.default = "d";

// FILE: files/a8.js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
__exportStar(require("./a8o"), exports);

// FILE: files/a8o.js
/** @type {any} */ (exports.y) = "o.y";

// FILE: files/a9.js
[exports.f = () => "first"] = [() => "second"];

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: row show _interop
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=LeftOutOfExecutable name="row"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=function
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = String string="F"
// CHECK-NEXT: Jump -> next b6(v3)
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = Builtin builtin=String
// CHECK-NEXT: v6 = Call v5, -, v4 calleeName="String"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b6(v8):
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="_interop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}] results=[{type=undefined|null|number|string|symbol|bigint|[[L_2]]|[[L_3]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b7(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = PropGet v2 key="__esModule"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Jump -> next b9(v2)
// CHECK-NEXT: b6(v6):
// CHECK-NEXT: Jump -> next b8(v2)
// CHECK-NEXT: b7(v7):
// CHECK-NEXT: Jump -> next b8(v7)
// CHECK-NEXT: b8(v8):
// CHECK-NEXT: v9 = NewObject -, v8 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v10 = FinishObject v9
// CHECK-NEXT: Jump -> next b9(v10)
// CHECK-NEXT: b9(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]]|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
