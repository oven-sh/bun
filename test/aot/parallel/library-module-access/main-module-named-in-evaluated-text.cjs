// Only source text that the program evaluates names process.mainModule. The build can read that text, so it finds the module object of the entry point, as code written in the file would.
exports.marker = "exports of the entry point";
console.log((0, eval)("typeof process.mainModule"), new Function("return typeof process.mainModule")(), new Function("return typeof require")());
console.log((0, eval)("process.mainModule.exports.marker"), new Function("return process.mainModule.id")());
console.log(new Function("return typeof process.mainModule.require")(), (0, eval)("process.mainModule.children.length"));
