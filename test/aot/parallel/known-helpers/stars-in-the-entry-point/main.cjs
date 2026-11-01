// The entry point is a barrel as TypeScript emits it for CommonJS. Bun reads `default` and `then` on what the entry point exports. The loop of __exportStar walks the names of a file of the program, so the names it passes on are known: none of them is `then`, and `default` is left out. The executable holds the two files, the helpers and what prints a line.
// STATISTIC: ImageFunctionsEmitted <= 16
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
__exportStar(require("./leaf.cjs"), exports);
console.log(exports.one, exports.two, exports.three, exports.default);
