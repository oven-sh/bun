"use strict";
const call = (0, eval)("(name) => globalThis[name]()");
exports.first = call("look");
exports.total = 41;
exports.second = call("look");
