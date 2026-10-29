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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="d"
// CHECK-NEXT: v7 = TypeTest v6 testedType=function
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = TypeTest v9 testedType=null|object
// CHECK-NEXT: Branch v10 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = Builtin builtin=JSON
// CHECK-NEXT: v13 = PropGet v12 key="stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="d"
// CHECK-NEXT: v17 = Call v14, v12, v16 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8(v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="d"
// CHECK-NEXT: v22 = Convert v21 declared={type=3 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8(v22)
// CHECK-NEXT: b8(v23):
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="a"
// CHECK-NEXT: v26 = Convert v25 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="b"
// CHECK-NEXT: v29 = TypeOf v28
// CHECK-NEXT: v30 = Call v4, v2, v23, v26, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v31 = Builtin builtin=GlobalThis
// CHECK-NEXT: v32 = PropGet v31 key="globalThis" [isFreeName]
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v34 = NewClosure function=[[f_4]]
// CHECK-NEXT: PropSet v33, v34 key="again"
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|[[L_5]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = ImportModule module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Promise<undefined|null|[[L_5]]> flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
