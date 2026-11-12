// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: main.cjs module.mjs data.json file.cjs
// STATISTIC: SourceFilesInferred = 3
// STATISTIC: SourceFilesData = 1

// FILE: main.cjs
// The children of a file that requires files of three kinds under names made at run time.
const { basename } = require("node:path");
const names = JSON.parse(process.env.NAMES ?? '["./module.mjs", "./data.json", "./file.cjs"]');
for (const name of [...names, ...names, ...names]) {
  require(name);
  console.log(name, module.children.map(child => basename(child.filename)).join());
}

// FILE: data.json
{ "a": 1 }

// FILE: file.cjs
console.log("file: parent", module.parent && module.parent.id);

// FILE: module.mjs
export const one = 1;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
