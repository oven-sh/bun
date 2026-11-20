// A loader of an extension is called on the object that holds it: it hands the file on to the loader that its receiver holds under ".js".
const Module = require("node:module");
const seen = [];
Module._extensions[".cjs"] = function (module, filename) {
  seen.push(this === Module._extensions, this === module);
  this[".js"](module, filename);
};
if (process.argv.length > 99) require("./subject.cjs");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".cjs");
console.log(got.value, seen.join());
