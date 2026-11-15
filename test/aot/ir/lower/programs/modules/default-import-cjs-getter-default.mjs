// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 6

// FILE: main.mjs
// A CommonJS file with `__esModule` defines `default` with a getter that is not enumerable. No loop over its exports sees the getter, so the default import
// is the whole exports. Whoever requires the file runs the getter.
import whole, { other } from "./lib.cjs";
import * as all from "./lib.cjs";
import overNoFlag from "./over-a-file-without-the-flag.cjs";
import { read } from "./reader.cjs";

console.log(JSON.stringify(whole), other, Object.keys(all), JSON.stringify(all.default), JSON.stringify(overNoFlag), read());

// FILE: inner.cjs
exports.default = "text of a file without the flag";

// FILE: lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./marked.cjs");
Object.defineProperty(exports, "default", { get: function () { return below_1.default; } });
exports.other = 2;

// FILE: marked.cjs
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = "text";

// FILE: over-a-file-without-the-flag.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "default", { get: function () { return below_1.default; } });

// FILE: reader.cjs
var lib = require("./lib.cjs");
var second = require("./over-a-file-without-the-flag.cjs");
exports.read = function () {
  return [lib.default, second.default];
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
