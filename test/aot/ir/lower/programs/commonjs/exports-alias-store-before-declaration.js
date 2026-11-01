// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.js
// CommonJS modules that store to a property of `var u = exports` (or of a required module) before that declaration has run.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
try { console.log("i1: " + show(require("./files/i1").log)); } catch (e) { console.log("i1: threw " + e.name); }
try { console.log("i2: " + show(require("./files/i2").log)); } catch (e) { console.log("i2: threw " + e.name); }
try { console.log("i3: " + show(require("./files/i3").log)); } catch (e) { console.log("i3: threw " + e.name); }
try { console.log("i4: " + show(require("./files/i4").log)); } catch (e) { console.log("i4: threw " + e.name); }
try { console.log("i5: " + show(require("./files/i5").log)); } catch (e) { console.log("i5: threw " + e.name); }

// FILE: files/i1.js
const log = [];
try { u.a = log.push("right side"); } catch (e) { log.push("caught " + e.name); }
var u = exports;
exports.log = log.join();

// FILE: files/i2.js
const log = [];
try { u.a = log.push("right side"); } catch (e) { log.push("caught " + e.name); }
var u = module.exports;
exports.log = log.join();

// FILE: files/i3.js
const log = [];
try { u.a += log.push("right side"); } catch (e) { log.push("caught " + e.name); }
var u = exports;
exports.log = log.join();

// FILE: files/i4.js
const log = [];
try { m.a = log.push("right side"); } catch (e) { log.push("caught " + e.name); }
var m = require("./io");
exports.log = log.join();

// FILE: files/i5.js
const log = [];
try { c.a = log.push("right side"); } catch (e) { log.push("caught " + e.name); }
const c = exports;
exports.log = log.join();

// FILE: files/io.js
exports.a = 0;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: row show
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=LeftOutOfExecutable name="row"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
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
