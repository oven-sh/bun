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

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="x"
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="x"
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="x"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="x"
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="x"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="x"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="star_of_star_1"
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="star_of_star_2"
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="star_of_star_3"
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="named_of_star_1"
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="named_of_star_2"
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="named_of_star_3"
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="star_of_named_of_star_1"
// CHECK-NEXT: v34 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v35 = CheckInitialized v34 name="star_of_named_of_star_2"
// CHECK-NEXT: v36 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v37 = CheckInitialized v36 name="star_of_named_of_star_3"
// CHECK-NEXT: v38 = Call v4, v2, v6, v8, v10, v12, v14, v16, v17, v18, v19, v21, v23, v25, v27, v29, v31, v33, v35, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
