// RUN: lower

// FILE: main.ts
import "./inner/lib.ts";

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"allowJs":true,"noImplicitAny":false,"maxNodeModuleJsDepth":2}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"allowJs":true,"noImplicitAny":false}}

// FILE: inner/lib.ts
import { text } from "pkg";
const n: number = text();
console.log(n);

// FILE: inner/node_modules/pkg/index.js
exports.kept = function (x) { return x; };
exports.text = function () { return "text"; };

// FILE: inner/node_modules/pkg/package.json
{"name":"pkg","version":"1.0.0","main":"./index.js"}
