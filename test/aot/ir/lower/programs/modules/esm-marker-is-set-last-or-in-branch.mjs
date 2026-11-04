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
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=JSON
// CHECK-NEXT: v6 = PropGet v5 key="stringify"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = Call v7, v5, v8 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v11 = Builtin builtin=JSON
// CHECK-NEXT: v12 = PropGet v11 key="stringify"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="e"
// CHECK-NEXT: v16 = Call v13, v11, v15 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v17 = Call v4, v2, v9, v10, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
