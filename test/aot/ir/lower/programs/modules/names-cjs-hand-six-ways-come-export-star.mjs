// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 73

// FILE: main.mjs
// CommonJS files hand the names of other CommonJS files on in six ways, through one, two and three files: getters as TypeScript writes them, its helpers
// `__exportStar` and `__createBinding`, `Object.assign`, stores, and `module.exports = require(..)`. A module hands the names of the last file on with
// `export *`, and nothing but the entry point imports one of them, from that module.
import { x as getters_1 } from "./getters-1/barrel.mjs";
import { x as getters_2 } from "./getters-2/barrel.mjs";
import { x as getters_3 } from "./getters-3/barrel.mjs";
import { x as export_star_1 } from "./export-star-1/barrel.mjs";
import { x as export_star_2 } from "./export-star-2/barrel.mjs";
import { x as export_star_3 } from "./export-star-3/barrel.mjs";
import { x as create_binding_1 } from "./create-binding-1/barrel.mjs";
import { x as create_binding_2 } from "./create-binding-2/barrel.mjs";
import { x as create_binding_3 } from "./create-binding-3/barrel.mjs";
import { x as assign_1 } from "./assign-1/barrel.mjs";
import { x as assign_2 } from "./assign-2/barrel.mjs";
import { x as assign_3 } from "./assign-3/barrel.mjs";
import { x as stores_1 } from "./stores-1/barrel.mjs";
import { x as stores_2 } from "./stores-2/barrel.mjs";
import { x as stores_3 } from "./stores-3/barrel.mjs";
import { x as whole_1 } from "./whole-1/barrel.mjs";
import { x as whole_2 } from "./whole-2/barrel.mjs";
import { x as whole_3 } from "./whole-3/barrel.mjs";

console.log(getters_1, getters_2, getters_3, export_star_1, export_star_2, export_star_3, create_binding_1, create_binding_2, create_binding_3, assign_1, assign_2, assign_3, stores_1, stores_2, stores_3, whole_1, whole_2, whole_3);

// FILE: assign-1/barrel.mjs
export * from "./lib.cjs";

// FILE: assign-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "assign-1";
exports.y = 2;

// FILE: assign-1/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.assign(exports, require("./inner.cjs"));

// FILE: assign-2/barrel.mjs
export * from "./lib.cjs";

// FILE: assign-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "assign-2";
exports.y = 2;

// FILE: assign-2/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.assign(exports, require("./middle.cjs"));

// FILE: assign-2/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.assign(exports, require("./inner.cjs"));

// FILE: assign-3/barrel.mjs
export * from "./lib.cjs";

// FILE: assign-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "assign-3";
exports.y = 2;

// FILE: assign-3/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.assign(exports, require("./middle.cjs"));

// FILE: assign-3/low.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.assign(exports, require("./inner.cjs"));

// FILE: assign-3/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.assign(exports, require("./low.cjs"));

// FILE: create-binding-1/barrel.mjs
export * from "./lib.cjs";

// FILE: create-binding-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "create-binding-1";
exports.y = 2;

// FILE: create-binding-1/lib.cjs
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
var below_1 = require("./inner.cjs");
__createBinding(exports, below_1, "x");
__createBinding(exports, below_1, "y");

// FILE: create-binding-2/barrel.mjs
export * from "./lib.cjs";

// FILE: create-binding-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "create-binding-2";
exports.y = 2;

// FILE: create-binding-2/lib.cjs
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
var below_1 = require("./middle.cjs");
__createBinding(exports, below_1, "x");
__createBinding(exports, below_1, "y");

// FILE: create-binding-2/middle.cjs
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
var below_1 = require("./inner.cjs");
__createBinding(exports, below_1, "x");
__createBinding(exports, below_1, "y");

// FILE: create-binding-3/barrel.mjs
export * from "./lib.cjs";

// FILE: create-binding-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "create-binding-3";
exports.y = 2;

// FILE: create-binding-3/lib.cjs
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
var below_1 = require("./middle.cjs");
__createBinding(exports, below_1, "x");
__createBinding(exports, below_1, "y");

// FILE: create-binding-3/low.cjs
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
var below_1 = require("./inner.cjs");
__createBinding(exports, below_1, "x");
__createBinding(exports, below_1, "y");

// FILE: create-binding-3/middle.cjs
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
var below_1 = require("./low.cjs");
__createBinding(exports, below_1, "x");
__createBinding(exports, below_1, "y");

// FILE: export-star-1/barrel.mjs
export * from "./lib.cjs";

// FILE: export-star-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "export-star-1";
exports.y = 2;

// FILE: export-star-1/lib.cjs
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
__exportStar(require("./inner.cjs"), exports);

// FILE: export-star-2/barrel.mjs
export * from "./lib.cjs";

// FILE: export-star-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "export-star-2";
exports.y = 2;

// FILE: export-star-2/lib.cjs
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
__exportStar(require("./middle.cjs"), exports);

// FILE: export-star-2/middle.cjs
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
__exportStar(require("./inner.cjs"), exports);

// FILE: export-star-3/barrel.mjs
export * from "./lib.cjs";

// FILE: export-star-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "export-star-3";
exports.y = 2;

// FILE: export-star-3/lib.cjs
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
__exportStar(require("./middle.cjs"), exports);

// FILE: export-star-3/low.cjs
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
__exportStar(require("./inner.cjs"), exports);

// FILE: export-star-3/middle.cjs
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
__exportStar(require("./low.cjs"), exports);

// FILE: getters-1/barrel.mjs
export * from "./lib.cjs";

// FILE: getters-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "getters-1";
exports.y = 2;

// FILE: getters-1/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: getters-2/barrel.mjs
export * from "./lib.cjs";

// FILE: getters-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "getters-2";
exports.y = 2;

// FILE: getters-2/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: getters-2/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: getters-3/barrel.mjs
export * from "./lib.cjs";

// FILE: getters-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "getters-3";
exports.y = 2;

// FILE: getters-3/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./middle.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: getters-3/low.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./inner.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: getters-3/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
var below_1 = require("./low.cjs");
Object.defineProperty(exports, "x", { enumerable: true, get: function () { return below_1.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return below_1.y; } });

// FILE: stores-1/barrel.mjs
export * from "./lib.cjs";

// FILE: stores-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "stores-1";
exports.y = 2;

// FILE: stores-1/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./inner.cjs");
exports.x = below_1.x;
exports.y = below_1.y;

// FILE: stores-2/barrel.mjs
export * from "./lib.cjs";

// FILE: stores-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "stores-2";
exports.y = 2;

// FILE: stores-2/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./middle.cjs");
exports.x = below_1.x;
exports.y = below_1.y;

// FILE: stores-2/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./inner.cjs");
exports.x = below_1.x;
exports.y = below_1.y;

// FILE: stores-3/barrel.mjs
export * from "./lib.cjs";

// FILE: stores-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "stores-3";
exports.y = 2;

// FILE: stores-3/lib.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./middle.cjs");
exports.x = below_1.x;
exports.y = below_1.y;

// FILE: stores-3/low.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./inner.cjs");
exports.x = below_1.x;
exports.y = below_1.y;

// FILE: stores-3/middle.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var below_1 = require("./low.cjs");
exports.x = below_1.x;
exports.y = below_1.y;

// FILE: whole-1/barrel.mjs
export * from "./lib.cjs";

// FILE: whole-1/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "whole-1";
exports.y = 2;

// FILE: whole-1/lib.cjs
"use strict";
module.exports = require("./inner.cjs");

// FILE: whole-2/barrel.mjs
export * from "./lib.cjs";

// FILE: whole-2/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "whole-2";
exports.y = 2;

// FILE: whole-2/lib.cjs
"use strict";
module.exports = require("./middle.cjs");

// FILE: whole-2/middle.cjs
"use strict";
module.exports = require("./inner.cjs");

// FILE: whole-3/barrel.mjs
export * from "./lib.cjs";

// FILE: whole-3/inner.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.y = exports.x = void 0;
exports.x = "whole-3";
exports.y = 2;

// FILE: whole-3/lib.cjs
"use strict";
module.exports = require("./middle.cjs");

// FILE: whole-3/low.cjs
"use strict";
module.exports = require("./inner.cjs");

// FILE: whole-3/middle.cjs
"use strict";
module.exports = require("./low.cjs");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
