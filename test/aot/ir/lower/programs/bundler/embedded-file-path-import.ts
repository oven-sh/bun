// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// A file is embedded in the executable and imported for its path.
/// <reference path="./asset/types.d.ts" />
import path from "./asset/data.bin" with { type: "file" }
import { readFileSync } from "node:fs"
console.log(typeof path, path.endsWith(".bin"), readFileSync(path, "utf8").trim())

// FILE: asset/data.bin
asset bytes
// FILE: asset/types.d.ts
declare module "*.bin" { const path: string; export default path }

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
// CHECK-NEXT: v6 = CheckInitialized v5 name="path"
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="path"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v11 = PropGet v10 key="endsWith"
// CHECK-NEXT: v12 = String string=".bin"
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeKey="endsWith" calleeName="path.endsWith"
// CHECK-NEXT: v14 = Convert v13 declared={type=boolean site=[[w_2]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="readFileSync"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(NodeFsReadFileSync) flags=[IsExpected]}
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="path"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v21 = String string="utf8"
// CHECK-NEXT: v22 = Call v17, -, v20, v21 calleeName="readFileSync"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v24 = PropGet v23 key="trim"
// CHECK-NEXT: v25 = Call v24, v23 calleeKey="trim" calleeName="trim"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v27 = Call v4, v2, v7, v14, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
