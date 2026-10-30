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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="__require"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="node:zlib"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = StrictEq v7, v9
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = Call v9, -, v8 calleeName="__require"
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="node:zlib"
// CHECK-NEXT: Jump -> next b4(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="gunzipSync"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="__require"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v20 = String string="zlib"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: v22 = StrictEq v19, v21
// CHECK-NEXT: Branch v22 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v23 = Call v21, -, v20 calleeName="__require"
// CHECK-NEXT: Jump -> next b7(v23)
// CHECK-NEXT: b6():
// CHECK-NEXT: v24 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="zlib"
// CHECK-NEXT: Jump -> next b7(v24)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="gzipSync"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v29 = String string="text"
// CHECK-NEXT: v30 = Call v28, v26, v29 calleeKey="gzipSync" calleeName="gzipSync"
// CHECK-NEXT: v31 = Call v16, v14, v30 calleeKey="gunzipSync" calleeName="gunzipSync"
// CHECK-NEXT: v32 = PropGet v31 key="toString"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v33, v31 calleeKey="toString" calleeName="toString"
// CHECK-NEXT: v35 = Call v4, v2, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Builtin builtin=GlobalThis
// CHECK-NEXT: v37 = PropGet v36 key="console" [isFreeName]
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="log"
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="metaRequire"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v44 = String string="node:querystring"
// CHECK-NEXT: v45 = Undefined
// CHECK-NEXT: v46 = StrictEq v43, v45
// CHECK-NEXT: Branch v46 -> taken b8(), notTaken b9()
// CHECK-NEXT: b8():
// CHECK-NEXT: v47 = Call v45, -, v44 calleeName="metaRequire"
// CHECK-NEXT: Jump -> next b10(v47)
// CHECK-NEXT: b9():
// CHECK-NEXT: v48 = RequireModule module=[[m_7]] referrer=[[m_0]] specifier="node:querystring"
// CHECK-NEXT: Jump -> next b10(v48)
// CHECK-NEXT: b10(v49):
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v51 = PropGet v50 key="stringify"
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v53 = Data data=[[d_9]]
// CHECK-NEXT: v54 = Call v52, v50, v53 calleeKey="stringify" calleeName="stringify"
// CHECK-NEXT: v55 = Call v40, v38, v54 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v56 = Undefined
// CHECK-NEXT: Return v56
// CHECK-NEXT: }
