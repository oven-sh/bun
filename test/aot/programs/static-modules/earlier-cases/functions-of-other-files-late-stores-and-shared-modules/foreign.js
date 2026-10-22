"use strict";
const other = require("./other");
exports.name = "foreign";
exports.f = other.helper;
exports.g = function () { return this === exports; };
