"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var inner = require("./inner.cjs");
Object.defineProperty(exports, "x", { get: function () { return inner.x; } });
Object.defineProperty(exports, "y", { enumerable: true, get: function () { return inner.y; } });
exports.default = "the default";
