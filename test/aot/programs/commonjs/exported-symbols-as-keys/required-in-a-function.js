"use strict";
exports.read = function read(thing) {
    const { kLate } = require("./keys-required-late");
    thing[kLate] = (thing[kLate] || 0) + 1;
    return thing[kLate];
};
