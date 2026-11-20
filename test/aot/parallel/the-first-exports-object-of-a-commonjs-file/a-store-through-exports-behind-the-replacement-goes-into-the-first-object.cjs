"use strict";
const first = exports;
exports.early = 1;
module.exports = { fresh: true };
exports.late = 2;
console.log(first === exports, first.early, first.late, module.exports.late, module.exports.fresh, Object.keys(first).join(), this === first);
