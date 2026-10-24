"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.own = void 0;
var impl_1 = require("./impl");
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return impl_1.a; } });
Object.defineProperty(exports, "renamed", { enumerable: true, get: function () { return impl_1.f; } });
Object.defineProperty(exports, "count", { enumerable: true, get: function () { return impl_1.count; } });
Object.defineProperty(exports, "bump", { enumerable: true, get: () => impl_1["bump"] });
exports.own = "own";
