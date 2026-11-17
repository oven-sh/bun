// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// A CommonJS file defines a getter that returns a name of a second file, where a getter returns a binding of the top level. A module imports the
// name from the first file and, beside it, the default, which it looks at as a whole; another module hands the name on.
import outer, { number } from "./outer.cjs";
import { number as handedOn, whole } from "./hands-on.mjs";

console.log(outer, number, handedOn, whole === outer);

// FILE: hands-on.mjs
export { number, default as whole } from "./outer.cjs";

// FILE: inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "number", { enumerable: true, get: function () { return number; } });
const number = 1;

// FILE: outer.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var inner_1 = require("./inner.cjs");
Object.defineProperty(exports, "number", { enumerable: true, get: function () { return inner_1.number; } });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
