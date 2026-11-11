// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.mjs
// Seven forms of import and export evaluate in the order of the text.
console.log("main body");
import "./a.mjs";
export * from "./b.mjs";
import {} from "./c.mjs";
export {} from "./d.mjs";
import * as unused from "./e.mjs";
import "./a.mjs";

// FILE: a.mjs
import "./shared.mjs"; console.log("a");

// FILE: b.mjs
console.log("b"); export const b = 1;

// FILE: c.mjs
import "./shared.mjs"; console.log("c");

// FILE: d.mjs
console.log("d");

// FILE: e.mjs
console.log("e");

// FILE: shared.mjs
console.log("shared");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
