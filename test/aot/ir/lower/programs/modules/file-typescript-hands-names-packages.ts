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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Shape"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="square"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Shape"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="SecondShape"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="second square"
// CHECK-NEXT: v10 = Construct v8, -, v9 calleeName="SecondShape"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v5 key="describe"
// CHECK-NEXT: v18 = Call v17, v5 calleeKey="describe" calleeName="square.describe"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="sides"
// CHECK-NEXT: v22 = Convert v21 declared={type=4} illTypedCause=Assertion
// CHECK-NEXT: v23 = PropGet v11 key="describe"
// CHECK-NEXT: v24 = Call v23, v11 calleeKey="describe" calleeName="second.describe"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="secondSides"
// CHECK-NEXT: v28 = Convert v27 declared={type=4} illTypedCause=Assertion
// CHECK-NEXT: v29 = Call v16, v14, v19, v22, v25, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked, IsHiddenInStackTraces] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = TypeTest v0 testedType=absent
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v2) frequency=Unlikely:
// CHECK-NEXT: v3 = ThrowModuleFailure failure=q0
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b3(v4):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v7) frequency=Unlikely:
// CHECK-NEXT: v8 = ThrowModuleFailure failure=q1
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b5(v9):
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]]
