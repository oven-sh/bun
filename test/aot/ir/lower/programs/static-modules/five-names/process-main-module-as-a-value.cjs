// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// `process.mainModule` held as a value, in the entry point and in a file that it requires.
const main = process.mainModule;
console.log(main === module, main === require.main, main.id, main.filename === __filename);
exports.answer = 42;
console.log(main.exports === exports, main.exports.answer, typeof main.require);
require("./other.cjs").show();

// FILE: other.cjs
exports.show = () => console.log(process.mainModule === require.main, process.mainModule !== module, process.mainModule.exports.answer);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
