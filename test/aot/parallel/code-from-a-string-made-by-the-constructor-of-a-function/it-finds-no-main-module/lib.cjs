"use strict";
exports.make = function (text) { return exports.twice.constructor(text); };
exports.twice = function (n) { return n * 2; };
