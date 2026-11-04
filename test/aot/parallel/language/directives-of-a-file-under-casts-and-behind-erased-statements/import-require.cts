import Path = require("node:path");
"use strict";
console.log("behind import = require:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
