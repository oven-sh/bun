"use strict";
exports.find = function (name) { return require((0, eval)("(n) => './' + n + '.cjs'")(name)); };
