// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 3

// FILE: main.ts
// The package names one file for `import` and another for `require`. Where a program does both, both get the file for `require`, also in a file under a tsconfig.json with other compiler options, from which no `require` of the package is reached.
import { kindByName, kindByNamespace, kindOfOther } from "./strict/importer.ts";

const required: { kind: string } = require("two-files");
console.log(required.kind, kindByName(), kindByNamespace(), kindOfOther());

// FILE: node_modules/only-imported/imported.js
export const kind = "the file for import";

// FILE: node_modules/only-imported/index.d.ts
export declare const kind: string;

// FILE: node_modules/only-imported/package.json
{ "name": "only-imported", "main": "./required.js", "module": "./imported.js", "types": "./index.d.ts" }

// FILE: node_modules/only-imported/required.js
exports.kind = "the file for require";

// FILE: node_modules/two-files/imported.js
export const kind = "the file for import";

// FILE: node_modules/two-files/index.d.ts
export declare const kind: string;

// FILE: node_modules/two-files/package.json
{ "name": "two-files", "main": "./required.js", "module": "./imported.js", "types": "./index.d.ts" }

// FILE: node_modules/two-files/required.js
exports.kind = "the file for require";

// FILE: strict/importer.ts
import * as other from "only-imported";
import * as both from "two-files";
import { kind } from "two-files";

export const kindByName = (): string => kind;
export const kindByNamespace = (): string => both.kind;
export const kindOfOther = (): string => other.kind;

// FILE: strict/tsconfig.json
{ "compilerOptions": { "strict": true } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
