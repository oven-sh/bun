// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.js
// Modules that are one function, called by another module.
console.log(require("./user").run(5));

// FILE: both.js
exports = module.exports = function both() { return "both"; };
exports.sub = "sub";

// FILE: declared.js
"use strict";
module.exports = declared;
function declared(a) { return "declared" + a; }
declared.extra = "extra";

// FILE: fn.js
"use strict";
module.exports = function fn(a, b) { return a + b; };

// FILE: user.js
"use strict";
const fn = require("./fn"), declared = require("./declared"), both = require("./both");
exports.run = function run(n) { let s = 0; for (let i = 0; i < n; i++) s = fn(s, i); return s + declared(1) + declared.extra + both() + both.sub; };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
