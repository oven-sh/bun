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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="main"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|"main" flags=[IsExpected]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="keys"
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v10 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v9, v8, v11 calleeName="Object.keys"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v13 calleeKey="join" calleeName="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v18 = Builtin builtin=String
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="default"
// CHECK-NEXT: v21 = Convert v20 declared={type=7 flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v18, -, v21 calleeName="String"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v24 = Call v6, v4, v1, v7, v17, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = String string="main lazy"
// CHECK-NEXT: v31 = Builtin builtin=String
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v33 calleeName="lazy"
// CHECK-NEXT: v35 = Convert v34 declared={type=7 flags=[IsExpected]}
// CHECK-NEXT: v36 = Call v31, -, v35 calleeName="String"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v38 = Call v29, v27, v30, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
