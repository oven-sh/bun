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

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v5 key="add"
// CHECK-NEXT: v12 = Call v11, v5 calleeKey="add" calleeName="written.add"
// CHECK-NEXT: v13 = PropGet v5 key="limit"
// CHECK-NEXT: v14 = Call v10, v8, v12, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v17 = Convert v16 declared={type=[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="console" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="log"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v17 key="sum"
// CHECK-NEXT: v24 = Call v23, v17 calleeKey="sum" calleeName="written_earlier.sum"
// CHECK-NEXT: v25 = PropGet v17 key="top"
// CHECK-NEXT: v26 = Call v22, v20, v24, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v29 = Convert v28 declared={type=[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v29 key="product"
// CHECK-NEXT: v36 = Call v35, v29 calleeKey="product" calleeName="by_hand.product"
// CHECK-NEXT: v37 = PropGet v29 key="bottom"
// CHECK-NEXT: v38 = Call v34, v32, v36, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
