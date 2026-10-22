"use strict";
var registry_1 = require("./registry");
exports.seen = registry_1.emit("get");
var x_1 = require("./x");
Object.defineProperty(exports, "g", { enumerable: true, get: function () { return x_1.g; } });
