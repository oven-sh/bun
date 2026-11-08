"use strict";
const { createRequire } = require("node:module");
const own = arguments[1];
require = createRequire(__filename);
console.log(own === require);
