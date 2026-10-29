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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="data"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="version"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="data"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="nested"
// CHECK-NEXT: v13 = PropGet v12 key="port"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="never"
// CHECK-NEXT: v16 = TypeTest v15 testedType=string
// CHECK-NEXT: Branch v16 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v17):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="never"
// CHECK-NEXT: Jump -> next b6(v19)
// CHECK-NEXT: b4(v20):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = String string=""
// CHECK-NEXT: Jump -> next b6(v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = Call v4, v2, v8, v13, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
