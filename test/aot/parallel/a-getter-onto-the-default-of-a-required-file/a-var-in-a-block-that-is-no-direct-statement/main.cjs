"use strict";
const leaf = require("./leaf.cjs");
const user = require("./user.cjs");
console.log(leaf.default, user.read(), user.other());
