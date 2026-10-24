const external = function (module) {
  module.exports = eval("require")("node:path");
};
const loaded = { exports: {} };
external(loaded);
console.log(typeof loaded.exports.join, loaded.exports.posix.join("a", "b"));

function readInFunction(text) {
  return eval(text);
}
const readInArrow = (text) => eval(text);
for (const read of [readInFunction, readInArrow]) {
  console.log(["exports", "require", "module", "__filename", "__dirname"].map((name) => typeof read(name)).join(" "));
  console.log(read("module.exports === exports"), read("require('node:path')") === loaded.exports);
}
console.log(eval("typeof exports"), eval("module.exports === exports"), eval("__filename.startsWith(__dirname)"));
