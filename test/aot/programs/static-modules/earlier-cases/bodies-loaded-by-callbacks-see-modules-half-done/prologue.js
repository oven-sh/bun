"use strict";
exports.f = f;
var dep = require("./dep_prologue");
var m = require("./x");
function f() { return m.g; }
exports.fromHook = dep.fromHook;
