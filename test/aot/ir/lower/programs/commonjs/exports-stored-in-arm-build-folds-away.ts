// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 6

// FILE: main.ts
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

// FILE: by-constant.js
if (false) {
  module.exports = require("./not-there.js");
} else {
  module.exports = require("./development.js");
}

// FILE: development.js
"use strict";
exports.useState = function (x) { return ["development", x]; };
exports.version = "19.development";

// FILE: handed-on.js
module.exports = require("./index.js");

// FILE: index.js
'use strict';
if (process.env.NODE_ENV === 'production') {
  module.exports = require('./production.js');
} else {
  module.exports = require('./development.js');
}

// FILE: names.js
if (process.env.NODE_ENV === "production") {
  exports.kept = require("./not-there.js");
  exports.alsoKept = 5;
} else {
  exports.kept = "kept";
  exports.alsoKept = function () { return "called"; };
}

// FILE: production.js
"use strict";
exports.useState = function (x) { return ["production", x]; };
exports.version = "19.production";

// FILE: user.cjs
const React = require("./index.js");
exports.viaRequire = function () { return React.useState(4).join() + React.version; };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
