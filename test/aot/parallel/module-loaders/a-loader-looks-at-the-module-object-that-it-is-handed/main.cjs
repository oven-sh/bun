const Module = require("node:module");
const path = require("node:path");
const asked = [];
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  asked.push(path.basename(module.id), path.basename(module.filename), module.loaded, JSON.stringify(module.exports), module.parent === require.main, module instanceof Module);
  const answer = original(module, filename);
  asked.push(answer, module.loaded, JSON.stringify(module.exports));
};
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js");
console.log(got.value, asked.join());
