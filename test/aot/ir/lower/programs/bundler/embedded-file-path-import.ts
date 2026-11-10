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
