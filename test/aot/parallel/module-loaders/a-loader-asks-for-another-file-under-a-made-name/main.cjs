const Module = require("node:module");
const path = require("node:path");
const asked = [];
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  asked.push(path.basename(filename));
  if (path.basename(filename) === "subject.js") asked.push(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"other\"") + ".js").value);
  return original(module, filename);
};
if (process.argv.length > 99) require("./other.js");
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js");
console.log(got.value, asked.join());
