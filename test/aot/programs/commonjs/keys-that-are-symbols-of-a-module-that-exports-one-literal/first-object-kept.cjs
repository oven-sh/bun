"use strict";
// The first exports object is used before another value takes its place, and afterwards.
const first = exports;
exports.onFirst = Symbol("on the first object");
module.exports = { kSecond: Symbol("second"), first, isThis: this === first };
first.afterwards = 1;
