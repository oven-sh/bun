// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
// The es module marker is set last or in a branch.
import d, { x } from "./m.cjs";
import e from "./n.cjs";
console.log(JSON.stringify(d), x, JSON.stringify(e));

// FILE: m.cjs
exports.x = 1;
exports.default = "the default";
Object.defineProperty(exports, "__esModule", { value: true });

// FILE: n.cjs
exports.default = "n default";
if (Date.now() > 0) exports.__esModule = true;

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
// CHECK-NEXT: v5 = Builtin builtin=JSON
// CHECK-NEXT: v6 = PropGet v5 key="stringify"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|"the default" flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v7, v5, v9 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v13 = Convert v12 declared={type=1 flags=[IsExpected]}
// CHECK-NEXT: v14 = Builtin builtin=JSON
// CHECK-NEXT: v15 = PropGet v14 key="stringify"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="e"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|"n default" flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v16, v14, v19 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v4, v2, v11, v13, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
