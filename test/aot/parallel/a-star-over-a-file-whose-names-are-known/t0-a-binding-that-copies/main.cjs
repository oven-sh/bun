"use strict";
const lib = require("./lib.cjs");
const out = [lib.count];
lib.next();
out.push(lib.count, lib.next(), lib.count);
console.log(out.join());
