import type Path = require("node:path");
"use strict";
module.exports = 1;
console.log("behind import type = require in a .ts file:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
