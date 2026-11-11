const path = require("node:path");
const calls = [];
const original = require.extensions[".js"];
require.extensions[".js"] = function (module, filename) { calls.push(path.basename(filename)); return original(module, filename); };
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js");
console.log(got.value, calls.join());
