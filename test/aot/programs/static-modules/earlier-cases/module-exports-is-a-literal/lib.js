"use strict";
const helper = require("./helper");
function a() { return "a"; }
const K = 5;
module.exports = { a, K, b: 2, anonymous: function () { return "anon"; }, arrow: () => "arrow", method() { return "method"; }, viaHelper: helper.h, "quoted-name": 1 };
module.exports.extra = "extra";
module.exports.callsOwn = function () { return module.exports.a() + module.exports.b; };
