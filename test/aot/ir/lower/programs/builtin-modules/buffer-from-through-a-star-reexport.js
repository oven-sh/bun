// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// Buffer.from is written in JavaScript. This program names it only through a module of its own that exports everything of node:buffer again.
import { Buffer as B } from "./again.js";
console.log(B.from("abc").length);

// FILE: again.js
export * from "node:buffer";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
