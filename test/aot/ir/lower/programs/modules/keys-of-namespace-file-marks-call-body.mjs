// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// Keys of the namespace of a file that marks itself behind a call out of its body.
import "./first.cjs";
import * as ns from "./k.cjs";
const who = "main";
console.log(who, "keys", Object.keys(ns).join(), String(ns.default));
import { lazy } from "./lazy.cjs";
console.log("main lazy", String(lazy()));

// FILE: first.cjs
console.log("first begins");
globalThis.called = function () { globalThis.called = function () {}; const k = require("./k.cjs"); console.log("hook", k.__esModule, String(k.default), k.x, k.early); };
console.log("first", String(require("./lazy.cjs").lazy()));

// FILE: k.cjs
console.log("k begins");
exports.early = 1;
globalThis.called();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = 7;
exports.x = 8;
console.log("k ends");

// FILE: lazy.cjs
exports.lazy = function () { return require("./k.cjs").default; };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
