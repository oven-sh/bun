// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// `var a = b; var b = a`: each variable is initialized with the other and both hold undefined.
const m = require("./m.cjs");
console.log(m.x, m.y, Object.keys(m).join());
console.log(JSON.stringify(Object.entries(require("./literal.cjs"))));

// FILE: literal.cjs
var first = second;
var second = third;
var third = first;
module.exports = { first, second, third };

// FILE: m.cjs
var a = b;
var b = a;
exports.x = a;
module.exports.y = b;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
