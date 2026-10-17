"use strict";
const { kAlone } = require("./keys-alone");
exports.readUnderAMakerOfValuesAlone = function readUnderAMakerOfValuesAlone(object) { return object[kAlone]; };
