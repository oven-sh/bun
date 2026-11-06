// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 41

// FILE: main.mjs
// Names behind getters of CommonJS files come through `export *`: the two files need each other, the name is stored on some runs, it is stored again
// later, the getter has another name, the modules need each other, the module has names of its own, two stars lead to one file, the name holds a class
// or a function, it is a name of a module that hands it on in its turn, and the module is required or imported on demand.
import { x as cycle, y as seenInCycle } from "./cycle/barrel.mjs";
import { x as onSomeRuns } from "./on-some-runs/barrel.mjs";
import { x as stored, again } from "./stored-again/barrel.mjs";
import { outside } from "./another-name/barrel.mjs";
import { x as modulesInCycle, read } from "./modules-in-a-cycle/barrel.mjs";
import { x as besideOwn, y as hidden, own, more } from "./beside-names-of-its-own/barrel.mjs";
import { x as firstStar, y as secondStar } from "./two-stars/barrel.mjs";
import { Base } from "./a-class/barrel.mjs";
import { f } from "./a-function/barrel.mjs";
import * as functions from "./a-function/barrel.mjs";
import { x as ofModule } from "./a-name-of-a-module/barrel.mjs";
import required from "./required/asks.cjs";

export const here = "here";

class Heir extends Base {
  two() {
    return this.one() + 1;
  }
}

console.log(cycle, seenInCycle, onSomeRuns);
console.log(stored, again(), stored);
console.log(outside, modulesInCycle, read());
console.log(besideOwn, hidden, own, more, firstStar, secondStar);
console.log(new Heir().two(), new Heir() instanceof Base, f(), functions.f());
console.log(ofModule, required);
const onDemand = await import("./imported-on-demand/barrel.mjs");
console.log(onDemand.x, Object.keys(onDemand));

// FILE: a-class/barrel.mjs
export * from "./lib.cjs";

// FILE: a-class/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Base = void 0;
class Base {
    one() {
        return 1;
    }
}
exports.Base = Base;

// FILE: a-class/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Base = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "Base", { enumerable: true, get: function () { return below_1.Base; } });

// FILE: a-function/barrel.mjs
export * from "./lib.cjs";

// FILE: a-function/inner.cjs
exports.f = function () {
  return this === undefined ? "no this" : typeof this;
};

// FILE: a-function/lib.cjs
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "f", { enumerable: true, get: function () { return below_1.f; } });

// FILE: a-name-of-a-module/barrel.mjs
export * from "./lib.cjs";

// FILE: a-name-of-a-module/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "a name of a module";
exports.y = 2;

// FILE: a-name-of-a-module/inner.mjs
export * from "./inner.cjs";

// FILE: a-name-of-a-module/lib.cjs
var below_1 = require("./inner.mjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });

// FILE: another-name/barrel.mjs
export * from "./lib.cjs";

// FILE: another-name/inner.cjs
exports.inside = "another name";

// FILE: another-name/lib.cjs
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "outside", { enumerable: true, get: function () { return below_1.inside; } });

// FILE: beside-names-of-its-own/barrel.mjs
export * from "./lib.cjs";
export * from "./more.mjs";
export const own = "own";
export const y = "hides";

// FILE: beside-names-of-its-own/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "beside names of its own";
exports.y = 2;

// FILE: beside-names-of-its-own/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: beside-names-of-its-own/more.mjs
export const more = "more";

// FILE: cycle/barrel.mjs
export * from "./lib.cjs";

// FILE: cycle/inner.cjs
exports.x = "cycle";
var lib = require("./lib.cjs");
exports.y = typeof lib.x;

// FILE: cycle/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: imported-on-demand/barrel.mjs
export * from "./lib.cjs";

// FILE: imported-on-demand/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "imported on demand";
exports.y = 2;

// FILE: imported-on-demand/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: modules-in-a-cycle/barrel.mjs
import { here } from "../main.mjs";
export * from "./lib.cjs";
export const read = () => here;

// FILE: modules-in-a-cycle/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "modules in a cycle";
exports.y = 2;

// FILE: modules-in-a-cycle/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: on-some-runs/barrel.mjs
export * from "./lib.cjs";

// FILE: on-some-runs/inner.cjs
if (typeof process === "object") exports.x = "on some runs";
exports.y = 2;

// FILE: on-some-runs/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: required/asks.cjs
const { x } = require("./barrel.mjs");
const all = require("./barrel.mjs");
module.exports = [x, all.y];

// FILE: required/barrel.mjs
export * from "./lib.cjs";

// FILE: required/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "required";
exports.y = 2;

// FILE: required/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: stored-again/barrel.mjs
export * from "./lib.cjs";

// FILE: stored-again/inner.cjs
exports.x = "stored";
exports.again = function () {
  exports.x += " again";
  return exports.x;
};

// FILE: stored-again/lib.cjs
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "again", { enumerable: true, get: function () { return below_1.again; } });

// FILE: two-stars/barrel.mjs
export * from "./lib.cjs";
export * from "./lib2.cjs";

// FILE: two-stars/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "two stars";
exports.y = 2;

// FILE: two-stars/lib.cjs
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });

// FILE: two-stars/lib2.cjs
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: Heir two
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="two"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_2]] flags=[IsExpected]} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="one"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v3, v1 calleeKey="one" calleeName="this.one"
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
