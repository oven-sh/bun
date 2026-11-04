// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// Names stored in a chain by a file that calls nothing and is imported again late.
import d, { a, b } from "./q.cjs"; console.log(typeof d === "object" ? JSON.stringify(d) : d, a, typeof b); globalThis.again = () => import("./q.cjs");

// FILE: q.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.b = exports.a = void 0;
exports.a = 1;
exports.b = 2;
exports.default = 3;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="d"
// CHECK-NEXT: v7 = TypeTest v6 testedType=function
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b1(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = TypeTest v8 testedType=null|object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3()
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = Builtin builtin=JSON
// CHECK-NEXT: v12 = PropGet v11 key="stringify"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="d"
// CHECK-NEXT: v16 = Call v13, v11, v15 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b3():
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="d"
// CHECK-NEXT: Jump -> next b4(v18)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="a"
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="b"
// CHECK-NEXT: v24 = TypeOf v23
// CHECK-NEXT: v25 = Call v4, v2, v19, v21, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="globalThis" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v29 = NewClosure function=[[f_4]]
// CHECK-NEXT: PropSet v28, v29 key="again"
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = ImportModule module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
