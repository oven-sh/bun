// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 21

// FILE: main.js
// One file for each thing that a requirer can do to the exports object of another file that names alone cannot express.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("keys", () => Object.keys(require("./keys.js")).join());
show("stored", () => { const m = require("./stored.js"); m.a = 10; m.c = 30; return m.read(); });
show("deleted", () => { const m = require("./deleted.js"); delete m.a; return m.read(); });
show("spread", () => Object.keys({ ...require("./spread.js") }).join());
show("forin", () => { const seen = []; for (const k in require("./forin.js")) seen.push(k); return seen.join(); });
show("passed", () => JSON.stringify(require("./passed.js")));
show("returned", () => { const get = () => require("./returned.js"); return get().a + get().b; });
show("compared", () => { const m = require("./compared.js"); return m === require("./compared.js"); });
show("computed", () => { const m = require("./computed.js"); const k = "a"; return m[k]; });
show("rest", () => { const { a, ...others } = require("./rest.js"); return [a, Object.keys(others).join()]; });
show("reassigned", () => { let m = require("./reassigned.js"); const first = m.a; m = { a: "other" }; return [first, m.a]; });
show("twice", () => { var m = require("./twice.js"); var m = { a: "second" }; return m.a; });
show("typeofm", () => typeof require("./typeofm.js"));
show("optional", () => { const m = require("./optional.js"); return m?.a; });
show("held", () => { const m = require("./held.js"); const box = { m }; return box.m.b; });
show("exported", () => { exports.again = require("./exported.js"); return exports.again.a; });
show("called", () => require("./called.js")());
show("inop", () => "a" in require("./inop.js"));
show("templ", () => `${require("./templ.js")}`);
show("native", () => { const m = require("./native.js"); const before = m.swapped(); m.swap(); return [m.has("a"), m.has("zz"), m.bound(), before, m.swapped()]; });

// FILE: called.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: compared.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: computed.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: deleted.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: exported.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: forin.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: held.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: inop.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: json.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: keys.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: native.js
exports.a = 1;
exports.has = Object.prototype.hasOwnProperty;
exports.bound = function () { return this; }.bind("bound");
exports.swapped = function () { return "first"; };
exports.swap = function () { exports.swapped = function () { return this === exports; }; };

// FILE: optional.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: passed.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: reassigned.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: rest.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: returned.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: spread.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: stored.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: templ.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: twice.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: typeofm.js
exports.a = 1; exports.b = 2; exports.read = function () { return [exports.a, exports.b, exports.c].join(); };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show get
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
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v18 = CatchValue
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = String string="threw"
// CHECK-NEXT: v25 = ToBoolean v18
// CHECK-NEXT: Branch v25 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v26):
// CHECK-NEXT: v27 = PropGet v18 key="constructor"
// CHECK-NEXT: Jump -> next b5(v27)
// CHECK-NEXT: b4(v28):
// CHECK-NEXT: Jump -> next b5(v28)
// CHECK-NEXT: b5(v29):
// CHECK-NEXT: v30 = ToBoolean v29
// CHECK-NEXT: Branch v30 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v31):
// CHECK-NEXT: v32 = PropGet v18 key="constructor"
// CHECK-NEXT: v33 = PropGet v32 key="name"
// CHECK-NEXT: Jump -> next b8(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8(v34)
// CHECK-NEXT: b8(v35):
// CHECK-NEXT: v36 = Call v23, v21, v0, v24, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
