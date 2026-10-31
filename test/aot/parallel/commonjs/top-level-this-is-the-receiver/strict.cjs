"use strict";
const first = exports;
exports = undefined;
console.log(this === first, this === module.exports);
