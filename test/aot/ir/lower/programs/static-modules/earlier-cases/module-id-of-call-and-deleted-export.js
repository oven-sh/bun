// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.js
// `module.id`, `this` of a call through `module.exports`, and `delete module.exports`.
const show = (name, f) => { try { console.log(name, [].concat(f()).map(String).join(" ")); } catch (e) { console.log(name, "threw", e && e.constructor && e.constructor.name); } };
show("id", () => { const m = require("./id"); return [m.t]; });
show("calledthis", () => require("./calledthis").viaModule);
show("deleted", () => typeof require("./deleted"));

// FILE: calledthis.js
module.exports = function () { return this === module; };
module.exports.viaModule = module.exports();

// FILE: deleted.js
exports.a = 1;
exports.deleted = delete module.exports;

// FILE: id.js
exports.t = typeof module.exports + ":" + (module.exports === exports);
exports.loaded = typeof module.loaded;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
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
