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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Data data=[[d_2]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="concat"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v1 calleeName="f"
// CHECK-NEXT: v12 = Call v10, v8, v11 calleeKey="concat" calleeName="concat"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="map"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Builtin builtin=String
// CHECK-NEXT: v17 = Call v15, v13, v16 calleeKey="map" calleeName="map"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="join"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" "
// CHECK-NEXT: v22 = Call v20, v18, v21 calleeKey="join" calleeName="join"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v24 = Call v6, v4, v0, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v25 = CatchValue
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = String string="threw"
// CHECK-NEXT: v32 = ToBoolean v25
// CHECK-NEXT: Branch v32 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v33):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v34 = PropGet v33 key="constructor"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8(v35, v33)
// CHECK-NEXT: b7(v36):
// CHECK-NEXT: Jump -> next b8(v36, v36)
// CHECK-NEXT: b8(v37, v38):
// CHECK-NEXT: v39 = ToBoolean v37
// CHECK-NEXT: Branch v39 -> taken b9(| 0), notTaken b11(| 0)
// CHECK-NEXT: b9(v40):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v41 = PropGet v38 key="constructor"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v43 = PropGet v42 key="name"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b12(v44)
// CHECK-NEXT: b11(v45):
// CHECK-NEXT: Jump -> next b12(v45)
// CHECK-NEXT: b12(v46):
// CHECK-NEXT: v47 = Call v30, v28, v0, v31, v46 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v48 = Undefined
// CHECK-NEXT: Return v48
// CHECK-NEXT: }
