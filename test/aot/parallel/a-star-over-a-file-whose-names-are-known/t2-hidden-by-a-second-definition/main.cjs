"use strict";
const lib = require("./lib.cjs");
console.log(lib.one, lib.two, "one" in lib, "two" in lib);
