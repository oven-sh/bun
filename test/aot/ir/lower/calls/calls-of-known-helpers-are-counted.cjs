// The helpers that TypeScript publishes are known by their text, and each call of __exportStar is written out in place: the build counts both.
// RUN: lower
// OPTIONS: builtin-modules
// CHECK: = TryReExportFields
// STATISTIC: KnownHelperFunctions >= 2
// STATISTIC: KnownHelperCalls = 3
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
const first = {};
__exportStar({ a: 1 }, first);
__exportStar({ b: 2 }, first);
function again(target) {
  __exportStar({ c: 3 }, target);
}
again(first);
console.log(Object.keys(first).join());
