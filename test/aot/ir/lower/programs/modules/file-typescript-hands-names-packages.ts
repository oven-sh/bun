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
