// Loads its WebAssembly as Emscripten's glue does: no read names the file beside the code by a path that is known.
var scriptDirectory = "", readBinary;
if (typeof process == "object") {
  var fs = require("node:fs");
  scriptDirectory = __dirname + "/";
  readBinary = file => fs.readFileSync(file);
} else {
  scriptDirectory = globalThis.document?.currentScript?.src ?? "";
}
var file;
module.exports = async (options = {}) => {
  file ??= options.locateFile ? options.locateFile("module.wasm", scriptDirectory) : scriptDirectory + "module.wasm";
  return (await WebAssembly.instantiate(readBinary(file), {})).instance.exports;
};
