// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 17

// FILE: main.js
// One file for each thing that a CommonJS file can do to its own exports object that names alone cannot express.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("passed", () => { const m = require("./passed.js"); return [m.own, m.added]; });
show("computed", () => { const m = require("./computed.js"); return [m.x, m.y, m.z]; });
show("usesthis", () => { const m = require("./usesthis.js"); const w = m.who; return [m.who(), (0, m.who)(), w(), m.callsOwn()]; });
show("deleted", () => { const m = require("./deleted.js"); return [m.a, m.b, m.has()]; });
show("typeofs", () => require("./typeofs.js").t);
show("proto", () => require("./proto.js").own);
show("local", () => { const m = require("./local.js"); return [m.a, m.b, m.keys()]; });
show("latemarker", () => { const m = require("./latemarker.js"); return [m.__esModule, m.mark(), m.__esModule]; });
show("reassigned", () => { const m = require("./reassigned.js"); return [m.lost, m.kept, m.alsoLost, m.real]; });
show("onevalue", () => { const m = require("./onevalue.js"); return [m(), m.extra, typeof m]; });
show("literal", () => { const m = require("./literal.js"); return [m.a(), m.b]; });
show("getter", () => { const m = require("./getter.js"); return [m.count, m.count]; });
show("frozenmarker", () => { const m = require("./frozenmarker.js"); return [m.threw, m.still]; });
show("valueofmarker", () => require("./valueofmarker.js").same);
show("orself", () => require("./orself.js").seen);

// FILE: common.js
module.exports = function setup(env) { env.added = Object.keys(env).join(); return env; };

// FILE: computed.js
for (const k of ["x", "y"]) exports[k] = k + k;
exports.z = 1;

// FILE: deleted.js
exports.a = 1; exports.b = 2; delete exports.a;
exports.has = function () { return "a" in exports; };

// FILE: frozenmarker.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
try { exports.__esModule = false; } catch (e) { exports.threw = e instanceof TypeError; }
exports.still = exports.__esModule;

// FILE: getter.js
let n = 0;
Object.defineProperty(exports, "count", { enumerable: true, get: function () { return ++n; } });

// FILE: latemarker.js
exports.a = 1;
exports.mark = function () { Object.defineProperty(exports, "__esModule", { value: true }); return exports.__esModule; };

// FILE: literal.js
function a() { return "a"; }
module.exports = { a, b: 2 };

// FILE: local.js
var self = exports;
self.a = 1; exports.b = 2;
exports.keys = function () { return Object.keys(self).join(); };

// FILE: onevalue.js
module.exports = function f() { return "called"; };
module.exports.extra = "x";

// FILE: orself.js
var root = this || {};
root.viaThis = 1;
exports.seen = exports.viaThis;

// FILE: passed.js
exports.own = 1;
require("./common.js")(exports);

// FILE: proto.js
exports.a = 1;
exports.own = exports.hasOwnProperty("a") + ":" + exports.hasOwnProperty("zz") + ":" + typeof exports.toString;

// FILE: reassigned.js
exports.lost = 1;
exports = { kept: 2 };
exports.alsoLost = 3;
module.exports.real = typeof exports.kept;

// FILE: typeofs.js
exports.t = typeof exports + typeof module + typeof module.exports;

// FILE: usesthis.js
"use strict";
exports.name = "usesthis";
exports.who = function () { return this === exports ? "exports:" + this.name : "other:" + (this === undefined ? "undefined" : this === globalThis ? "global" : typeof this); };
exports.callsOwn = function () { return exports.who(); };

// FILE: valueofmarker.js
var same = Object.defineProperty(exports, "__esModule", { value: true });
exports.same = same === exports;

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
