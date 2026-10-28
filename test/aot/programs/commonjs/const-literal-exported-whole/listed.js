"use strict";
const keys = require("./listed-keys");
module.exports = { keys, again() { return require("./listed-keys"); } };
