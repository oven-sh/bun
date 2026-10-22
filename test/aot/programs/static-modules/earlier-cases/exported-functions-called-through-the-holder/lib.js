"use strict";
const other_1 = require("./other");
const f = function (x) { return "f" + x; };
const arrow = (x) => "arrow" + x;
class K { static s() { return "s"; } }
exports.f = f; exports.arrow = arrow; exports.K = K;
exports.g = other_1.g;
