// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 85

// FILE: main.mjs
// CommonJS files define getters that return names of other CommonJS files, through one, two and three files. ES modules hand the names of the last file
// on: `export *` whose namespace is read, `export * as`, `export { x } from`, and those on top of each other. Each name has one importer.
import * as star_read_on_the_namespace_1 from "./star-read-on-the-namespace-1/barrel.mjs";
import * as star_read_on_the_namespace_2 from "./star-read-on-the-namespace-2/barrel.mjs";
import * as star_read_on_the_namespace_3 from "./star-read-on-the-namespace-3/barrel.mjs";
import { all as star_as_1 } from "./star-as-1/barrel.mjs";
import { all as star_as_2 } from "./star-as-2/barrel.mjs";
import { all as star_as_3 } from "./star-as-3/barrel.mjs";
import { x as named_1 } from "./named-1/barrel.mjs";
import { x as named_2 } from "./named-2/barrel.mjs";
import { x as named_3 } from "./named-3/barrel.mjs";
import { x as star_of_star_1 } from "./star-of-star-1/barrel.mjs";
import { x as star_of_star_2 } from "./star-of-star-2/barrel.mjs";
import { x as star_of_star_3 } from "./star-of-star-3/barrel.mjs";
import { x as named_of_star_1 } from "./named-of-star-1/barrel.mjs";
import { x as named_of_star_2 } from "./named-of-star-2/barrel.mjs";
import { x as named_of_star_3 } from "./named-of-star-3/barrel.mjs";
import { x as star_of_named_of_star_1 } from "./star-of-named-of-star-1/barrel.mjs";
import { x as star_of_named_of_star_2 } from "./star-of-named-of-star-2/barrel.mjs";
import { x as star_of_named_of_star_3 } from "./star-of-named-of-star-3/barrel.mjs";

console.log(star_read_on_the_namespace_1.x, star_read_on_the_namespace_2.x, star_read_on_the_namespace_3.x, star_as_1.x, star_as_2.x, star_as_3.x, named_1, named_2, named_3, star_of_star_1, star_of_star_2, star_of_star_3, named_of_star_1, named_of_star_2, named_of_star_3, star_of_named_of_star_1, star_of_named_of_star_2, star_of_named_of_star_3);

// FILE: named-1/barrel.mjs
export { x } from "./lib.cjs";

// FILE: named-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "named-1";
exports.y = 2;

// FILE: named-1/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-2/barrel.mjs
export { x } from "./lib.cjs";

// FILE: named-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "named-2";
exports.y = 2;

// FILE: named-2/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-2/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-3/barrel.mjs
export { x } from "./lib.cjs";

// FILE: named-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "named-3";
exports.y = 2;

// FILE: named-3/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-3/low.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-3/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./low.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-of-star-1/barrel.mjs
export { x } from "./below.mjs";

// FILE: named-of-star-1/below.mjs
export * from "./lib.cjs";

// FILE: named-of-star-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "named-of-star-1";
exports.y = 2;

// FILE: named-of-star-1/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-of-star-2/barrel.mjs
export { x } from "./below.mjs";

// FILE: named-of-star-2/below.mjs
export * from "./lib.cjs";

// FILE: named-of-star-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "named-of-star-2";
exports.y = 2;

// FILE: named-of-star-2/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-of-star-2/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-of-star-3/barrel.mjs
export { x } from "./below.mjs";

// FILE: named-of-star-3/below.mjs
export * from "./lib.cjs";

// FILE: named-of-star-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "named-of-star-3";
exports.y = 2;

// FILE: named-of-star-3/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-of-star-3/low.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: named-of-star-3/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./low.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-as-1/barrel.mjs
export * as all from "./lib.cjs";

// FILE: star-as-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-as-1";
exports.y = 2;

// FILE: star-as-1/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-as-2/barrel.mjs
export * as all from "./lib.cjs";

// FILE: star-as-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-as-2";
exports.y = 2;

// FILE: star-as-2/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-as-2/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-as-3/barrel.mjs
export * as all from "./lib.cjs";

// FILE: star-as-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-as-3";
exports.y = 2;

// FILE: star-as-3/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-as-3/low.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-as-3/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./low.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-named-of-star-1/barrel.mjs
export * from "./between.mjs";

// FILE: star-of-named-of-star-1/below.mjs
export * from "./lib.cjs";

// FILE: star-of-named-of-star-1/between.mjs
export { x } from "./below.mjs";

// FILE: star-of-named-of-star-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-of-named-of-star-1";
exports.y = 2;

// FILE: star-of-named-of-star-1/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-named-of-star-2/barrel.mjs
export * from "./between.mjs";

// FILE: star-of-named-of-star-2/below.mjs
export * from "./lib.cjs";

// FILE: star-of-named-of-star-2/between.mjs
export { x } from "./below.mjs";

// FILE: star-of-named-of-star-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-of-named-of-star-2";
exports.y = 2;

// FILE: star-of-named-of-star-2/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-named-of-star-2/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-named-of-star-3/barrel.mjs
export * from "./between.mjs";

// FILE: star-of-named-of-star-3/below.mjs
export * from "./lib.cjs";

// FILE: star-of-named-of-star-3/between.mjs
export { x } from "./below.mjs";

// FILE: star-of-named-of-star-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-of-named-of-star-3";
exports.y = 2;

// FILE: star-of-named-of-star-3/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-named-of-star-3/low.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-named-of-star-3/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./low.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-star-1/barrel.mjs
export * from "./below.mjs";

// FILE: star-of-star-1/below.mjs
export * from "./lib.cjs";

// FILE: star-of-star-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-of-star-1";
exports.y = 2;

// FILE: star-of-star-1/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-star-2/barrel.mjs
export * from "./below.mjs";

// FILE: star-of-star-2/below.mjs
export * from "./lib.cjs";

// FILE: star-of-star-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-of-star-2";
exports.y = 2;

// FILE: star-of-star-2/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-star-2/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-star-3/barrel.mjs
export * from "./below.mjs";

// FILE: star-of-star-3/below.mjs
export * from "./lib.cjs";

// FILE: star-of-star-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-of-star-3";
exports.y = 2;

// FILE: star-of-star-3/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-star-3/low.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-of-star-3/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./low.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-read-on-the-namespace-1/barrel.mjs
export * from "./lib.cjs";

// FILE: star-read-on-the-namespace-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-read-on-the-namespace-1";
exports.y = 2;

// FILE: star-read-on-the-namespace-1/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-read-on-the-namespace-2/barrel.mjs
export * from "./lib.cjs";

// FILE: star-read-on-the-namespace-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-read-on-the-namespace-2";
exports.y = 2;

// FILE: star-read-on-the-namespace-2/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-read-on-the-namespace-2/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-read-on-the-namespace-3/barrel.mjs
export * from "./lib.cjs";

// FILE: star-read-on-the-namespace-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "star-read-on-the-namespace-3";
exports.y = 2;

// FILE: star-read-on-the-namespace-3/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-read-on-the-namespace-3/low.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: star-read-on-the-namespace-3/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./low.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
