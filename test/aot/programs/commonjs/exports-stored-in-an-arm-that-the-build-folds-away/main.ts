// `module.exports = require(..)` in each arm of a test that the build folds: the arm that is folded away stores nothing, and the
// file that it names is not in the program. A TypeScript file imports the names of the other arm.
declare const console: { log(...values: unknown[]): void };
import { useState, version } from "./index.js";
import * as React from "./index.js";
import Default from "./index.js";
import { version as handedOn } from "./handed-on.js";
import { version as byConstant } from "./by-constant.js";
import { kept, alsoKept } from "./names.js";
import { viaRequire } from "./user.cjs";
console.log(useState(1).join(), version, React.useState(2).join(), React.version, Default.useState(3).join());
console.log(handedOn, byConstant, kept, alsoKept(), viaRequire());
