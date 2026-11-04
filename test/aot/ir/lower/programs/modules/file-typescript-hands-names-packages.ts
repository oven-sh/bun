// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 4

// FILE: main.ts
// Two packages that TypeScript compiled to CommonJS, with their declaration files: the main file of each hands the names of another file on, one by
// getters, one by `__exportStar`. A file of the program hands the names of each package on with `export *`, and the entry point imports them from there.
import { Shape, sides } from "./first-barrel";
import { Shape as SecondShape, sides as secondSides } from "./second-barrel";

const square: Shape = new Shape("square");
const second: SecondShape = new SecondShape("second square");
console.log(square.describe(), sides, second.describe(), secondSides);

// FILE: first-barrel.ts
export * from "hands-on-by-getters";

// FILE: node_modules/hands-on-by-export-star/lib/index.d.ts
export * from "./shape";

// FILE: node_modules/hands-on-by-export-star/lib/index.js
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./shape"), exports);

// FILE: node_modules/hands-on-by-export-star/lib/shape.d.ts
export declare class Shape {
    name: string;
    constructor(name: string);
    describe(): string;
}
export declare const sides = 4;

// FILE: node_modules/hands-on-by-export-star/lib/shape.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sides = exports.Shape = void 0;
class Shape {
    constructor(name) {
        this.name = name;
    }
    describe() {
        return "a " + this.name;
    }
}
exports.Shape = Shape;
exports.sides = 4;

// FILE: node_modules/hands-on-by-export-star/package.json
{ "name": "hands-on-by-export-star", "version": "1.0.0", "main": "./lib/index.js", "types": "./lib/index.d.ts" }

// FILE: node_modules/hands-on-by-getters/lib/index.d.ts
export { Shape, sides } from "./shape";

// FILE: node_modules/hands-on-by-getters/lib/index.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sides = exports.Shape = void 0;
var shape_1 = require("./shape");
Object.defineProperty(exports, "Shape", { enumerable: true, get: function () { return shape_1.Shape; } });
Object.defineProperty(exports, "sides", { enumerable: true, get: function () { return shape_1.sides; } });

// FILE: node_modules/hands-on-by-getters/lib/shape.d.ts
export declare class Shape {
    name: string;
    constructor(name: string);
    describe(): string;
}
export declare const sides = 4;

// FILE: node_modules/hands-on-by-getters/lib/shape.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sides = exports.Shape = void 0;
class Shape {
    constructor(name) {
        this.name = name;
    }
    describe() {
        return "a " + this.name;
    }
}
exports.Shape = Shape;
exports.sides = 4;

// FILE: node_modules/hands-on-by-getters/package.json
{ "name": "hands-on-by-getters", "version": "1.0.0", "main": "./lib/index.js", "types": "./lib/index.d.ts" }

// FILE: second-barrel.ts
export * from "hands-on-by-export-star";

// FILE: tsconfig.json
{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext" } }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Shape"
// CHECK-NEXT: v2 = String string="square"
// CHECK-NEXT: v3 = Construct v1, -, v2 calleeName="Shape"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="SecondShape"
// CHECK-NEXT: v7 = String string="second square"
// CHECK-NEXT: v8 = Construct v6, -, v7 calleeName="SecondShape"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v4 key="describe"
// CHECK-NEXT: v16 = Call v15, v4 calleeKey="describe" calleeName="square.describe"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="sides"
// CHECK-NEXT: v20 = PropGet v9 key="describe"
// CHECK-NEXT: v21 = Call v20, v9 calleeKey="describe" calleeName="second.describe"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="secondSides"
// CHECK-NEXT: v25 = Call v14, v12, v17, v19, v22, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked, IsHiddenInStackTraces] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = TypeTest v0 testedType=absent
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = ThrowModuleFailure failure=q0
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = ThrowModuleFailure failure=q1
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
