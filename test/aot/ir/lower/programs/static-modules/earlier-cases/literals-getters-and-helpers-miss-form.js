// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 24

// FILE: main.js
// `module.exports = { .. }`, getters and helpers that are almost of the form that needs no object.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("counting", () => { const m = require("./counting"); return [m.count, m.count]; });
show("ofobject", () => [require("./ofobject").v, require("./object").keys()]);
show("getterstored", () => { const m = require("./getterstored"); return [m.p, m.threw]; });
show("hidden", () => [require("./hidden").p, require("./hiddenuser").keys]);
show("ownhelper", () => require("./ownhelper").seen);
show("earlyhelper", () => require("./earlyhelper").seen);
show("boxused", () => require("./boxused").seen);
show("litandexports", () => { const m = require("./litandexports"); return [m.lost, m.kept, m.alsoLost]; });
show("litbefore", () => { const m = require("./litbefore"); return [m.lost, m.kept]; });
show("litspread", () => { const m = require("./litspread"); return [m.a, m.b, m.c1, m.d]; });
show("littwice", () => { const m = require("./littwice"); return [m.a, m.gone]; });
show("litthis", () => { const m = require("./litthis"); return [m.who(), m.f()]; });
show("litself", () => require("./litself").b);
show("litlate", () => { const m = require("./litlate"); return [m.a, m.fromEarly]; });
show("litcycle", () => { const m = require("./litcycle_a"); return [m.name, m.seenByB, m.lateByB()]; });
show("litproto", () => { const m = require("./litproto"); return [m.inherited, m.own]; });

// FILE: boxused.js
var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
const box = __importDefault(require("./plain4"));
exports.seen = Object.keys(box).join() + ":" + box.p + ":" + box.default.p;

// FILE: counting.js
let n = 0;
Object.defineProperty(exports, "count", { enumerable: true, get: function () { return ++n; } });

// FILE: earlyhelper.js
exports.__importDefault = function (mod) { return { default: { p: "from exports.__importDefault" } }; };
var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };
const plain_1 = __importDefault(require("./plain3"));
exports.seen = plain_1.default.p;

// FILE: getterstored.js
"use strict";
const plain_1 = require("./plain");
Object.defineProperty(exports, "p", { enumerable: true, get: function () { return plain_1.p; } });
try { exports.p = "stored"; } catch (e) { exports.threw = e.constructor.name; }

// FILE: hidden.js
const plain_1 = require("./plain");
Object.defineProperty(exports, "p", { get: function () { return plain_1.p; } });
exports.shown = 1;

// FILE: hiddenuser.js
exports.keys = Object.keys(require("./hidden")).join();

// FILE: litandexports.js
exports.lost = 1;
module.exports = { kept: 2 };
exports.alsoLost = 3;

// FILE: litbefore.js
module.exports.lost = 1;
module.exports = { kept: 2 };

// FILE: litcycle_a.js
const b = require("./litcycle_b");
module.exports = { name: "a", seenByB: b.sawName, lateByB: () => b.late() };

// FILE: litcycle_b.js
const a = require("./litcycle_a");
exports.sawName = String(a.name);
exports.late = function () { return String(a.name); };

// FILE: litlate.js
function early() { module.exports.fromEarly = "lost"; }
early();
module.exports = { a: 1 };

// FILE: litproto.js
module.exports = { __proto__: { inherited: "i" }, own: 1 };

// FILE: litself.js
module.exports = { a: 1, b: typeof module.exports.a };

// FILE: litspread.js
const base = { a: 1 };
module.exports = { ...base, b: 2, ["c" + 1]: 3, get d() { return 4; } };

// FILE: litthis.js
module.exports = { name: "litthis", who() { return this.name; }, f: function () { return this === module.exports; } };

// FILE: littwice.js
module.exports = { a: 1, gone: 1 };
module.exports = { a: 2 };

// FILE: object.js
exports.v = "v"; exports.keys = function () { return Object.keys(exports).join(); };

// FILE: ofobject.js
const object_1 = require("./object");
Object.defineProperty(exports, "v", { enumerable: true, get: function () { return object_1.v; } });

// FILE: ownhelper.js
var __importDefault = function (mod) { return { default: "custom", mod }; };
const plain_1 = __importDefault(require("./plain2"));
exports.seen = plain_1.default;

// FILE: plain.js
exports.p = "p";

// FILE: plain2.js
exports.p = "p2";

// FILE: plain3.js
exports.p = "p3";

// FILE: plain4.js
exports.p = "p4";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Data data=[[d_1]]
// CHECK-NEXT: v8 = PropGet v7 key="concat"
// CHECK-NEXT: v9 = Call v1 calleeName="f"
// CHECK-NEXT: v10 = Call v8, v7, v9 calleeKey="concat" calleeName="concat"
// CHECK-NEXT: v11 = PropGet v10 key="map"
// CHECK-NEXT: v12 = Builtin builtin=String
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeKey="map" calleeName="map"
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = String string=" "
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: v17 = Call v6, v4, v0, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v18 = CatchValue
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = String string="threw"
// CHECK-NEXT: v25 = ToBoolean v18
// CHECK-NEXT: Branch v25 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v26):
// CHECK-NEXT: v27 = PropGet v18 key="constructor"
// CHECK-NEXT: v28 = ToBoolean v27
// CHECK-NEXT: Branch v28 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v29):
// CHECK-NEXT: v30 = PropGet v18 key="constructor"
// CHECK-NEXT: v31 = PropGet v30 key="name"
// CHECK-NEXT: Jump -> next b7(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: Jump -> next b7(v32)
// CHECK-NEXT: b6(v33):
// CHECK-NEXT: Jump -> next b7(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: v35 = Call v23, v21, v0, v24, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
