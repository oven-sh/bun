"use strict";
const fn = require("./fn"), declared = require("./declared"), both = require("./both");
exports.run = function run(n) { let s = 0; for (let i = 0; i < n; i++) s = fn(s, i); return s + declared(1) + declared.extra + both() + both.sub; };
