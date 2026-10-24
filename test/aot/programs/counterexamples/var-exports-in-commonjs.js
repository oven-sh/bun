// `var exports = exports || {}` in a CommonJS file keeps the file's own exports object.
var exports = exports || {};
exports.a = 3;
console.log(module.exports.a);
