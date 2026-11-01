"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plain = void 0;
exports.plain = "plain";
var reads = 0;
Object.defineProperty(exports, "counted", { enumerable: true, get: function () { return ++reads; } });
Object.defineProperty(exports, "hidden", { enumerable: false, value: "hidden" });
Object.defineProperty(exports, "fixed", { enumerable: true, value: "fixed" });
