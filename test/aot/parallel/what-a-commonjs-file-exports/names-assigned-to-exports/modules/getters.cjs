"use strict";
let value = 10;
Object.defineProperty(exports, "live", { enumerable: true, get: function () { return value; } });
Object.defineProperty(exports, "hidden", { enumerable: false, get: function () { return value; } });
exports.advance = () => ++value;
