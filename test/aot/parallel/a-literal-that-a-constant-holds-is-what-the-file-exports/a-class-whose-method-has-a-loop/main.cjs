"use strict";
const held = require("./sum.cjs");
console.log(new held.Counter().count(4), held.Counter.twice(3), held.Counter.name);
