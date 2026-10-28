"use strict";
const { kHandled } = require("./keys-under-a-handler");
exports.readUnderAHandler = function readUnderAHandler(object) { return object[kHandled]; };
