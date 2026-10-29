// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 6

// FILE: main.ts
// `module.exports.x`, `this.x`, a variable that holds `exports`, getters onto other modules.
declare const console: { log(...values: unknown[]): void };
import { report, pattern } from "./user.cjs";
import theDefault, { s, g } from "./forEs.js";
import * as forEs from "./forEs.js";
console.log(report(), pattern);
console.log(s, g(1), forEs.s, forEs.g(2), theDefault, forEs.default);

// FILE: barrel.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.own = void 0;
var impl_1 = require("./impl");
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return impl_1.a; } });
Object.defineProperty(exports, "renamed", { enumerable: true, get: function () { return impl_1.f; } });
Object.defineProperty(exports, "count", { enumerable: true, get: function () { return impl_1.count; } });
Object.defineProperty(exports, "bump", { enumerable: true, get: () => impl_1["bump"] });
exports.own = "own";

// FILE: forEs.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const settled_1 = require("./settled");
Object.defineProperty(exports, "s", { enumerable: true, get: function () { return settled_1.s; } });
Object.defineProperty(exports, "g", { enumerable: true, get: function () { return settled_1.g; } });
Object.defineProperty(exports, "default", { enumerable: true, get: function () { return settled_1.s; } });

// FILE: impl.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.count = exports.f = exports.a = void 0;
exports.a = 1;
function f(x) { return "f" + x; }
exports.f = f;
exports.count = 0;
exports.bump = function () { exports.count++; };

// FILE: outer.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const barrel_1 = require("./barrel");
Object.defineProperty(exports, "twice", { enumerable: true, get: function () { return barrel_1.renamed; } });
const settled_1 = require("./settled");
Object.defineProperty(exports, "s", { enumerable: true, get: function () { return settled_1.s; } });
Object.defineProperty(exports, "g", { enumerable: true, get: function () { return settled_1.g; } });

// FILE: settled.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.g = exports.s = void 0;
exports.s = "s";
exports.g = function (x) { return "g" + x; };

// FILE: user.cjs
"use strict";
const barrel_1 = require("./barrel"), outer_1 = require("./outer");
exports.report = function () {
  const before = barrel_1.count; barrel_1.bump(); (0, barrel_1.bump)();
  return [barrel_1.a, barrel_1.renamed(1), (0, barrel_1.renamed)(2), barrel_1.own, before, barrel_1.count, outer_1.twice(3), outer_1.s, outer_1.g(4), barrel_1.missing].join(" ");
};
const { a, renamed } = require("./barrel");
exports.pattern = a + renamed(5);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v6 calleeName="report"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v11 = Call v4, v2, v8, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = Call v19, -, v20 calleeName="g"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v25 = ModuleNamespace module=[[m_9]]
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v27 = Integer integer=2
// CHECK-NEXT: v28 = Call v24, v26, v27 calleeName="forEs.g"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v32 = Call v16, v14, v17, v22, v23, v29, v30, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
