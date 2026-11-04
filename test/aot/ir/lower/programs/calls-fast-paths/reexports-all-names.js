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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v6 key="add"
// CHECK-NEXT: v13 = Call v12, v6 calleeKey="add" calleeName="written.add"
// CHECK-NEXT: v14 = PropGet v6 key="limit"
// CHECK-NEXT: v15 = Call v11, v9, v13, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v18 = Convert v17 declared={type=[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v19 key="sum"
// CHECK-NEXT: v26 = Call v25, v19 calleeKey="sum" calleeName="written_earlier.sum"
// CHECK-NEXT: v27 = PropGet v19 key="top"
// CHECK-NEXT: v28 = Call v24, v22, v26, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v31 = Convert v30 declared={type=[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[L_11]] flags=[IsExpected]}
// CHECK-NEXT: v33 = Builtin builtin=GlobalThis
// CHECK-NEXT: v34 = PropGet v33 key="console" [isFreeName]
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="log"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v32 key="product"
// CHECK-NEXT: v39 = Call v38, v32 calleeKey="product" calleeName="by_hand.product"
// CHECK-NEXT: v40 = PropGet v32 key="bottom"
// CHECK-NEXT: v41 = Call v37, v35, v39, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v42 = Undefined
// CHECK-NEXT: Return v42
// CHECK-NEXT: }
