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
