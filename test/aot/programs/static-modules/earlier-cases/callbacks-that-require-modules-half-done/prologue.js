"use strict";
exports.f = f;
var emits = require("./emits_prologue");
var m = require("./x");
function f() { return m.g; }
exports.seen = emits.seen;
