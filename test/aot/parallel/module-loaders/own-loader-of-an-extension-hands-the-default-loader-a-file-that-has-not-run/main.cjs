// The program's loader hands the default loader another file than the one that was asked for. That file has not run, so it runs now. The executable said that it could not run a second time: it asked whether the variable of the exports was empty, which it is not in front of the body.
const Module = require("node:module");
const path = require("node:path");
const asked = [];
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  asked.push(path.basename(filename));
  return original(module, path.join(path.dirname(filename), "other.js"));
};
if (process.argv.length > 99) require("./other.js");
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".js");
console.log(got.value, asked.join());
