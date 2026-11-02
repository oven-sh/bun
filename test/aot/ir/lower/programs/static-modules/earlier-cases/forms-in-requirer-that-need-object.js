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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
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
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=undefined|null|[[L_6]] flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v2 = Convert v1 declared={type=[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
