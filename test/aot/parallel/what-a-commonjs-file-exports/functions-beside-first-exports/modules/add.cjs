"use strict";
const path = require("node:path"), dep = require("./dep.cjs");
module.exports = function add(o, n) { return o.n + n + dep.two; };
