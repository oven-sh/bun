const path = require("node:path");
const calls = [];
const original = require.extensions[".json"];
require.extensions[".json"] = function (module, filename) { calls.push(path.basename(filename)); return original(module, filename); };
if (process.argv.length > 99) require("./subject.json");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".json");
console.log(got.value, calls.join());
