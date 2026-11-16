// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// `typeof` of the five names in a CommonJS file, and of three of them in an ES module.
import "./a.cjs";
export {};
console.log(typeof module, typeof exports, typeof require);

// FILE: a.cjs
console.log(typeof module, typeof exports, typeof require, typeof __filename, typeof __dirname);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
