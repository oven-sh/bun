"use strict";
// Loaded after somebody has stored another value under a name of the literal.
const { kChanged, kValue, kAdded, kRemoved } = require("./keys.cjs");
module.exports = function describe(object) {
  return [typeof kChanged, String(kChanged), typeof kAdded, String(kAdded), typeof kRemoved, object[kChanged], object[kValue]].join(" | ");
};
