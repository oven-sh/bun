"use strict";
var utils = exports;
const same = module.exports;
utils.a = "a";
same.b = "b";
exports.c = function () { return utils.a + same.b; };
utils.d = function () { return utils.c(); };
