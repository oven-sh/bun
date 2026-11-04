// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// `bun build --splitting --target=node` exports `__require = createRequire(import.meta.url)` from a shared chunk.
import { __require, metaRequire } from "./chunk.mjs";

console.log(__require("node:zlib").gunzipSync(__require("zlib").gzipSync("text")).toString());
console.log(metaRequire("node:querystring").stringify({ a: 1 }));

// FILE: chunk.mjs
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);
export var metaRequire = import.meta.require;
export { __require };

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="__require"
// CHECK-NEXT: v7 = String string="node:zlib"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = StrictEq v6, v8
// CHECK-NEXT: Branch v9 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v10 = Call v8, -, v7 calleeName="__require"
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = RequireModule module=[[m_2]] referrer=[[m_0]] specifier="node:zlib"
// CHECK-NEXT: Jump -> next b3(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = PropGet v12 key="gunzipSync"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="__require"
// CHECK-NEXT: v16 = String string="zlib"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = StrictEq v15, v17
// CHECK-NEXT: Branch v18 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Call v17, -, v16 calleeName="__require"
// CHECK-NEXT: Jump -> next b6(v19)
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = RequireModule module=[[m_2]] referrer=[[m_0]] specifier="zlib"
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = PropGet v21 key="gzipSync"
// CHECK-NEXT: v23 = String string="text"
// CHECK-NEXT: v24 = Call v22, v21, v23 calleeKey="gzipSync" calleeName="gzipSync"
// CHECK-NEXT: v25 = Call v13, v12, v24 calleeKey="gunzipSync" calleeName="gunzipSync"
// CHECK-NEXT: v26 = PropGet v25 key="toString"
// CHECK-NEXT: v27 = Call v26, v25 calleeKey="toString" calleeName="toString"
// CHECK-NEXT: v28 = Call v4, v2, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v35 = CheckInitialized v34 name="metaRequire"
// CHECK-NEXT: v36 = String string="node:querystring"
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: v38 = StrictEq v35, v37
// CHECK-NEXT: Branch v38 -> taken b7(), notTaken b8()
// CHECK-NEXT: b7():
// CHECK-NEXT: v39 = Call v37, -, v36 calleeName="metaRequire"
// CHECK-NEXT: Jump -> next b9(v39)
// CHECK-NEXT: b8():
// CHECK-NEXT: v40 = RequireModule module=[[m_4]] referrer=[[m_0]] specifier="node:querystring"
// CHECK-NEXT: Jump -> next b9(v40)
// CHECK-NEXT: b9(v41):
// CHECK-NEXT: v42 = PropGet v41 key="stringify"
// CHECK-NEXT: v43 = Data data=[[d_5]]
// CHECK-NEXT: v44 = Call v42, v41, v43 calleeKey="stringify" calleeName="stringify"
// CHECK-NEXT: v45 = Call v33, v31, v44 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v46 = Undefined
// CHECK-NEXT: Return v46
// CHECK-NEXT: }
