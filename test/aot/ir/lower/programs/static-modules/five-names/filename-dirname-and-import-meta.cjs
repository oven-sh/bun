// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// `__filename`, `import.meta` in a CommonJS file, and the number of arguments of its body: five, as in Node. Plain Bun hands `import.meta` to a file that names it as a sixth.
console.log(require("./a.cjs").join());

// FILE: a.cjs
module.exports = [require("node:path").basename(__filename), typeof import.meta.url, arguments.length];

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
