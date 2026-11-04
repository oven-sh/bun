// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// A function that nobody calls requires a json file.
import data from "./data.json";
import { never } from "./unused";
console.log(data.version, data.nested.port, typeof never === "string" ? never : "");

// FILE: data.json
{ "version": "1.2.3", "nested": { "port": 80, "deep": { "on": true, "off": null } }, "list": [1, 2, 3] }

// FILE: unused.ts
export function never() {
  return require("./data.json").version;
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="data"
// CHECK-NEXT: v7 = PropGet v6 key="version"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="data"
// CHECK-NEXT: v10 = PropGet v9 key="nested"
// CHECK-NEXT: v11 = PropGet v10 key="port"
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="never"
// CHECK-NEXT: v14 = TypeTest v13 testedType=string
// CHECK-NEXT: Branch v14 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v15):
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="never"
// CHECK-NEXT: Jump -> next b3(v17)
// CHECK-NEXT: b2(v18):
// CHECK-NEXT: v19 = String string=""
// CHECK-NEXT: Jump -> next b3(v19)
// CHECK-NEXT: b3(v20):
// CHECK-NEXT: v21 = Call v4, v2, v7, v11, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
