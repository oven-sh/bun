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
// CHECK-NEXT: v10 = PropGet v9 key="endsWith"
// CHECK-NEXT: v11 = String string=".bin"
// CHECK-NEXT: v12 = Call v10, v9, v11 calleeKey="endsWith" calleeName="path.endsWith"
// CHECK-NEXT: v13 = Convert v12 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="readFileSync"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(NodeFsReadFileSync) flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="path"
// CHECK-NEXT: v19 = String string="utf8"
// CHECK-NEXT: v20 = Call v16, -, v18, v19 calleeName="readFileSync"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = PropGet v21 key="trim"
// CHECK-NEXT: v23 = Call v22, v21 calleeKey="trim" calleeName="trim"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v25 = Call v4, v2, v7, v13, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
