"use strict";
function peek() { return typeof module.exports.kLate; }
const keys = {
    kLate: Symbol("late"),
};
const seen = peek();
module.exports = keys;
module.exports = { keys: module.exports, seen };
