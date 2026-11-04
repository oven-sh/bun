import type Path = require("node:path");
"use strict";
console.log("behind import type = require:", (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
