// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.js
// A CommonJS module that binds every name of another module to its own exports keeps them in variables where the other does: a name is read without a property access. The two functions that do it are known by what they do: as TypeScript writes them, as it wrote them earlier, by hand under other names.
const written = require("./files/written.js");
console.log(written.add(), written.limit);
const written_earlier = require("./files/written-earlier.js");
console.log(written_earlier.sum(), written_earlier.top);
const by_hand = require("./files/by-hand.js");
console.log(by_hand.product(), by_hand.bottom);

// FILE: files/by-hand-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bottom = exports.product = void 0;
function product() {
    return "product";
}
exports.product = product;
exports.bottom = "bottom";

// FILE: files/by-hand.js
"use strict";
var bind = (this && this.bind) || (Object.create ? function (target, source, key, as) {
  if (as === void 0) {
    as = key;
  }
  Object.defineProperty(target, as, { get: () => source[key], enumerable: true });
} : function (target, source, key, as) {
  if (as === void 0) {
    as = key;
  }
  target[as] = source[key];
});
var bindAll = (this && this.bindAll) || function (source, target) {
  for (const key in source) {
    if (key !== "default" && !Object.prototype.hasOwnProperty.call(target, key)) {
      bind(target, source, key);
    }
  }
};
Object.defineProperty(exports, "__esModule", { value: true });
bindAll(require("./by-hand-inner.js"), exports);

// FILE: files/written-earlier-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.top = exports.sum = void 0;
function sum() {
    return "sum";
}
exports.sum = sum;
exports.top = "top";

// FILE: files/written-earlier.js
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !exports.hasOwnProperty(p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./written-earlier-inner.js"), exports);

// FILE: files/written-inner.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.limit = exports.add = void 0;
function add() {
    return "add";
}
exports.add = add;
exports.limit = "limit";

// FILE: files/written.js
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
__exportStar(require("./written-inner.js"), exports);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
