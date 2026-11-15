const Module = require("node:module");
Module._extensions[".js"] = function (module, filename) { module.exports = { value: "from the loader" }; };
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js");
console.log(got.value, require.main.children.length, require("node:path").basename(require.main.children[0].filename), require.main.children[0].loaded);
