// A file that a wrapped function requires is a child of the file around it, and that file is its parent.
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var require_lib = __commonJS(function (exports, module) { exports.v = require("./real.cjs").v; });
var require_two = __commonJS(function (exports, module) { module.exports = { a: require_lib(), b: require("./two.cjs") }; });
console.log(JSON.stringify(require_two()), require("./real.cjs").who(), module.children.map(c => require("node:path").basename(c.id) + c.loaded).join());
