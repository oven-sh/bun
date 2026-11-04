// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// Keys of the namespace of a file that marks itself behind a call out of its body.
import "./first.cjs";
import * as ns from "./k.cjs";
const who = "main";
console.log(who, "keys", Object.keys(ns).join(), String(ns.default));
import { lazy } from "./lazy.cjs";
console.log("main lazy", String(lazy()));

// FILE: first.cjs
console.log("first begins");
globalThis.called = function () { globalThis.called = function () {}; const k = require("./k.cjs"); console.log("hook", k.__esModule, String(k.default), k.x, k.early); };
console.log("first", String(require("./lazy.cjs").lazy()));

// FILE: k.cjs
console.log("k begins");
exports.early = 1;
globalThis.called();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = 7;
exports.x = 8;
console.log("k ends");

// FILE: lazy.cjs
exports.lazy = function () { return require("./k.cjs").default; };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="main"
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="keys"
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v9 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v10 = Call v8, v7, v9 calleeName="Object.keys"
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = Call v11, v10 calleeKey="join" calleeName="join"
// CHECK-NEXT: v13 = Builtin builtin=String
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="default"
// CHECK-NEXT: v16 = Call v13, -, v15 calleeName="String"
// CHECK-NEXT: v17 = Call v5, v3, v0, v6, v12, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = String string="main lazy"
// CHECK-NEXT: v24 = Builtin builtin=String
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v26 = Call v25 calleeName="lazy"
// CHECK-NEXT: v27 = Call v24, -, v26 calleeName="String"
// CHECK-NEXT: v28 = Call v22, v20, v23, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
