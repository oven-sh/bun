// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// Parts of a json file are exported again and never read.
import data from "./data.json";
import { own } from "./barrel";
console.log(data.version, data.nested.port, own);

// FILE: barrel.ts
export { nested, list, version, default as whole } from "./data.json";
export const own = 1;

// FILE: data.json
{ "version": "1.2.3", "nested": { "port": 80, "deep": { "on": true, "off": null } }, "list": [1, 2, 3] }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
