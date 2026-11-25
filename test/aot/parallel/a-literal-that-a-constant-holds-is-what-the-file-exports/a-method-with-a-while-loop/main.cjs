// A CommonJS file exports an object literal that a constant holds. The build gives each name of the literal a variable and evaluates the literal at the store.
"use strict";
const held = require("./sum.cjs");
console.log(held.sum(1, 2));
