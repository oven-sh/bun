// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 29

// FILE: main.js
// CommonJS modules whose exports are getters that call `require` themselves.
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + e.name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
function show(v) { return typeof v === "function" ? "F" : String(v); }
try { console.log("a getter that requires: " + show(require("./files/b1").a)); } catch (e) { console.log("a getter that requires: threw " + e.name); }
try { console.log("a getter over a holder that never ran: " + show(require("./files/b2").a)); } catch (e) { console.log("a getter over a holder that never ran: threw " + e.name); }
try { require("./files/b2o");  console.log("the same, the other module evaluated: " + show(require("./files/b2").a)); } catch (e) { console.log("the same, the other module evaluated: threw " + e.name); }
try { console.log("control: a getter over a holder: " + show(require("./files/b3").a)); } catch (e) { console.log("control: a getter over a holder: threw " + e.name); }
try { console.log("a getter over a holder in a try: " + show(require("./files/b4").a)); } catch (e) { console.log("a getter over a holder in a try: threw " + e.name); }
try { console.log("a getter over a holder declared behind it: " + show(require("./files/b5").a)); } catch (e) { console.log("a getter over a holder declared behind it: threw " + e.name); }
try { console.log("a getter over a let in a block: " + show(require("./files/b6").a)); } catch (e) { console.log("a getter over a let in a block: threw " + e.name); }
try { console.log("a store above the star that does not run: " + show(require("./files/b7").x)); } catch (e) { console.log("a store above the star that does not run: threw " + e.name); }
try { console.log("a store above the star in a function: " + show(require("./files/b8").x)); } catch (e) { console.log("a store above the star in a function: threw " + e.name); }
try { console.log("control: the store above the star runs: " + show(require("./files/b9").x)); } catch (e) { console.log("control: the store above the star runs: threw " + e.name); }
try { console.log("control: a dead store below the star: " + show(require("./files/b10").x)); } catch (e) { console.log("control: a dead store below the star: threw " + e.name); }
try { require("./files/b11_bo");  console.log("a read above the star: " + show(require("./files/b11").early)); } catch (e) { console.log("a read above the star: threw " + e.name); }
try { console.log("a read below the star: " + show(require("./files/b12").late)); } catch (e) { console.log("a read below the star: threw " + e.name); }
try { require("./files/b13_bo");  console.log("a call above the star: " + show(require("./files/b13").early)); } catch (e) { console.log("a call above the star: threw " + e.name); }
try { console.log("an arrow as the getter, which requires: " + show(require("./files/b14").a)); } catch (e) { console.log("an arrow as the getter, which requires: threw " + e.name); }

// FILE: files/b1.js
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return require("./b1o").a; } });

// FILE: files/b10.js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
__exportStar(require("./b10_bo"), exports);
if (globalThis.never) exports.x = "own";

// FILE: files/b10_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b11.js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
exports.early = exports.x;
__exportStar(require("./b11_bo"), exports);

// FILE: files/b11_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b12.js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
__exportStar(require("./b12_bo"), exports);
exports.late = exports.x;

// FILE: files/b12_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b13.js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
try { exports.early = exports.f(); } catch (e) { exports.early = e.name; }
__exportStar(require("./b13_bo"), exports);

// FILE: files/b13_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b14.js
Object.defineProperty(exports, "a", { enumerable: true, get: () => require("./b14o").a });

// FILE: files/b14o.js
console.log("b14o runs");
exports.a = "from o";

// FILE: files/b1o.js
console.log("b1o runs");
exports.a = "from o";

// FILE: files/b2.js
if (globalThis.never) var m = require("./b2o");
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return m.a; } });

// FILE: files/b2o.js
exports.a = 1;

// FILE: files/b3.js
var m = require("./b3_bo");
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return m.x; } });

// FILE: files/b3_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b4.js
try { if (!globalThis.never) throw 0; var m = require("./b4_bo"); } catch {}
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return m.x; } });

// FILE: files/b4_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b5.js
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return m.x; } });
var m = require("./b5_bo");

// FILE: files/b5_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b6.js
let m;
{ m = require("./b6_bo"); }
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return m.x; } });

// FILE: files/b6_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b7.js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
if (globalThis.never) exports.x = "own";
__exportStar(require("./b7_bo"), exports);

// FILE: files/b7_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b8.js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
function never() { exports.x = "own"; }
__exportStar(require("./b8_bo"), exports);

// FILE: files/b8_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

// FILE: files/b9.js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; }));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
exports.x = "own";
__exportStar(require("./b9_bo"), exports);

// FILE: files/b9_bo.js
exports.x = "o.x";
exports.f = () => "o.f";

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
