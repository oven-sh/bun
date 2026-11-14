"use strict";
const dep = require("./dep.cjs");
class Box { constructor(n) { this.n = n; } get() { return this.n; } }
module.exports = Box;
