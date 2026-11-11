// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 2
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// A package without side effects exports and stores to its own package json.
import { pkg, version, port, spoil } from "quiet";
console.log(pkg.version, version, port(), pkg.nested.port);
spoil();
console.log(pkg.version, version, port(), pkg.nested.port);

// FILE: node_modules/quiet/index.js
export { default as pkg, version } from "./package.json";
export * from "./other.js";

// FILE: node_modules/quiet/other.js
import pkg from "./package.json";
export const port = () => pkg.nested.port;
export const spoil = () => { pkg.nested.port = 81; pkg.version = "9"; };

// FILE: node_modules/quiet/package.json
{ "name": "quiet", "version": "4.5.6", "main": "index.js", "sideEffects": false, "nested": { "port": 80 } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
