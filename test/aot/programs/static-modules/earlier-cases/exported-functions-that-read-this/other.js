"use strict";
exports.usesThis = function () { return this === undefined ? "undefined" : Object.keys(this).join(); };
