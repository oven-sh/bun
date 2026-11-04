import type Path = require("node:path");
"use strict";
console.log("a .ts file with the directive behind import type = require:", typeof arguments === "object" ? "CommonJS" : "an ES module");
