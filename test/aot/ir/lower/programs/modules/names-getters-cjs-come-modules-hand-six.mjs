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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="x"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|"star-read-on-the-namespace-1" flags=[IsExpected]}
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="x"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|"star-read-on-the-namespace-2" flags=[IsExpected]}
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="x"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|"star-read-on-the-namespace-3" flags=[IsExpected]}
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="x"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|"star-as-1" flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="x"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|"star-as-2" flags=[IsExpected]}
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="x"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|"star-as-3" flags=[IsExpected]}
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|"named-1" flags=[IsExpected]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|"named-2" flags=[IsExpected]}
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|"named-3" flags=[IsExpected]}
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="star_of_star_1"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|"star-of-star-1" flags=[IsExpected]}
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v33 = CheckInitialized v32 name="star_of_star_2"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|"star-of-star-2" flags=[IsExpected]}
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v36 = CheckInitialized v35 name="star_of_star_3"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|"star-of-star-3" flags=[IsExpected]}
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v39 = CheckInitialized v38 name="named_of_star_1"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|"named-of-star-1" flags=[IsExpected]}
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="named_of_star_2"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|"named-of-star-2" flags=[IsExpected]}
// CHECK-NEXT: v44 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v45 = CheckInitialized v44 name="named_of_star_3"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|"named-of-star-3" flags=[IsExpected]}
// CHECK-NEXT: v47 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v48 = CheckInitialized v47 name="star_of_named_of_star_1"
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|"star-of-named-of-star-1" flags=[IsExpected]}
// CHECK-NEXT: v50 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v51 = CheckInitialized v50 name="star_of_named_of_star_2"
// CHECK-NEXT: v52 = Convert v51 declared={type=undefined|null|"star-of-named-of-star-2" flags=[IsExpected]}
// CHECK-NEXT: v53 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v54 = CheckInitialized v53 name="star_of_named_of_star_3"
// CHECK-NEXT: v55 = Convert v54 declared={type=undefined|null|"star-of-named-of-star-3" flags=[IsExpected]}
// CHECK-NEXT: v56 = Call v4, v2, v7, v10, v13, v16, v19, v22, v24, v26, v28, v31, v34, v37, v40, v43, v46, v49, v52, v55 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v57 = Undefined
// CHECK-NEXT: Return v57
// CHECK-NEXT: }
