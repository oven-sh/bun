"use strict";
const { kLate } = require("./keys");
module.exports = { kLate, readLate(object) { return object[kLate]; } };
