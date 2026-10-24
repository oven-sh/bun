"use strict";
const other_1 = require("./other");
const viaConst = function () { return this === undefined ? "undefined" : Object.keys(this).join(); };
let reassigned = function () { return "first"; };
reassigned = function () { return this === undefined ? "undefined" : "second sees " + typeof this; };
exports.viaConst = viaConst; exports.viaOther = other_1.usesThis; exports.reassigned = reassigned;
