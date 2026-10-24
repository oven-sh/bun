eval("exports = module.exports = { a: 1 }");
exports.b = 2;
console.log("module.exports.b:", module.exports.b, JSON.stringify(module.exports));
function readExports() { return exports; }
console.log("a function reads the stored object:", readExports() === module.exports);
(function () { eval("exports = 'stored in a function'"); })();
console.log("stored by an eval in a function:", exports, readExports(), typeof module.exports);
console.log("read by a later eval:", eval("exports"));
