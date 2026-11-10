"use strict";
const held = require("./main.cjs");
exports.read = function () { return Object.keys(held).join() + ":" + held.early + ":" + held.late; };
exports.isSame = function (other) { return held === other; };
