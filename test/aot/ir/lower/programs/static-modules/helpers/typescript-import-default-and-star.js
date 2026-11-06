// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.js
// What TypeScript emits for `import plain from`, `import marked from` and `import * as star from` with esModuleInterop: a module without the marker is wrapped, one with it is taken as it is, and the members of the star are getters.
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const plain_1 = __importDefault(require("./plain"));
const marked_1 = __importDefault(require("./marked"));
const star = __importStar(require("./names"));
console.log((0, plain_1.default)(), marked_1.default, star.n, star.default.n, Object.keys(star).join());
star.bump();
console.log(star.n, star.default.n);

// FILE: marked.js
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = "marked default";

// FILE: names.js
exports.n = 1;
exports.bump = () => {
  exports.n++;
};

// FILE: plain.js
module.exports = () => "plain";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: get ownKeys
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} captures=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|number|string|symbol flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|number|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ownKeys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=1 captures=[{type=env [[L_2]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: env [[L_2]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=ObjectGetOwnPropertyNames
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v3 layout=[[L_2]]
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v6 = Call v5, -, v1 calleeName="ownKeys"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
