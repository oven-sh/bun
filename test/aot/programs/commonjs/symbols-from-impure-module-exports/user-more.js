"use strict";
const { kMore } = require("./keys-more");
exports.readUnderAMakerThatDoesMore = function readUnderAMakerThatDoesMore(object) { return object[kMore]; };
