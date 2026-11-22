var require = require || function () { return { name: "fallback" }; };
var module = module || {}, exports = exports || module.exports;
console.log(require("./dep.cjs").name);
exports.done = true;
console.log(Object.keys(module.exports));
