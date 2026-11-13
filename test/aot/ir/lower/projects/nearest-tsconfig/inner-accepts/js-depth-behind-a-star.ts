// RUN: lower

// FILE: main.ts
import "./inner/lib.ts";

// FILE: tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"allowJs":true,"noImplicitAny":false}}

// FILE: inner/tsconfig.json
{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","noEmit":true,"allowImportingTsExtensions":true,"strict":true,"skipLibCheck":true,"allowJs":true,"noImplicitAny":false,"maxNodeModuleJsDepth":2}}

// FILE: inner/lib.ts
import { kept } from "./between.ts";
console.log(kept(1));

// FILE: inner/between.ts
export * from "pkg";

// FILE: inner/node_modules/pkg/index.js
exports.kept = function (x) { return x; };
exports.text = function () { return "text"; };

// FILE: inner/node_modules/pkg/package.json
{"name":"pkg","version":"1.0.0","main":"./index.js"}
