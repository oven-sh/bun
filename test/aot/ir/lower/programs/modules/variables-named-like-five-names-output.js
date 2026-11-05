// RUN: lower
// OPTIONS: builtin-modules

// FILE: variables-named-like-five-names-output.js
// @bun
// Variables named like the five names of commonjs in the output of bun build.
var require = 1, module = 2, exports = 3, __filename = 4, __dirname = 5;
console.log(require, module, exports, __filename, __dirname, this);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
