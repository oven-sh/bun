// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8

// FILE: main.mjs
// An import of a name from the file that does not have it fails, beside an import of the same name through a getter of another file. The namespace
// objects list the getter, two files that require each other see each other half loaded, and an ES module that lacks the name answers undefined too.
import { absent } from "./lib.cjs";
import * as all from "./lib.cjs";
import { absent as ofModule } from "./over-a-module.cjs";
import { own, absent as inCycle } from "./first.cjs";
import { seen } from "./second.cjs";

console.log(absent, Object.keys(all).join(), all.absent, "absent" in all, ofModule, own, inCycle, seen);
const later = await import("./lib.cjs");
console.log(Object.keys(later).join(), later.absent, "absent" in later);
try {
  await import("./from-the-file-itself.mjs");
} catch (error) {
  console.log(error.name, error.message.includes("'absent'"), error.message.includes("inner.cjs"));
}

// FILE: first.cjs
var below_1 = require("./second.cjs");
Object.defineProperty(exports, "absent", { enumerable: true, get: function () { return below_1.absent; } });
exports.own = 1;

// FILE: from-the-file-itself.mjs
import { absent } from "./lib.cjs";
import { absent as direct } from "./inner.cjs";
console.log(absent, direct);

// FILE: inner.cjs
exports.present = 3;

// FILE: lib.cjs
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "absent", { enumerable: true, get: function () { return below_1.absent; } });

// FILE: module.mjs
export const present = 3;

// FILE: over-a-module.cjs
var below_1 = require("./module.mjs");
Object.defineProperty(exports, "absent", { enumerable: true, get: function () { return below_1.absent; } });

// FILE: second.cjs
var first = require("./first.cjs");
exports.present = 3;
exports.seen = typeof first.absent;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
